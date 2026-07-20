/**
 * withWidget.js
 *
 * Expo config plugin that adds the FuelogWidget WidgetKit extension to the
 * Xcode project during expo prebuild / EAS Build.
 *
 * What it does:
 *  1. Adds the App Groups entitlement to the main app target.
 *  2. Copies Swift source files from targets/widget/ into ios/FuelogWidget/.
 *  3. Adds a new Xcode native target (widget extension) with the correct
 *     product type, build settings, and build phases.
 *  4. Adds WidgetKit.framework (weak-linked) to the main app target so the
 *     FuelogNativeModule can call WidgetCenter.shared.reloadAllTimelines().
 *  5. Embeds the widget extension in the main app's IPA via a
 *     PBXCopyFilesBuildPhase.
 */

const {
  withXcodeProject,
  withEntitlementsPlist,
  withDangerousMod,
  IOSConfig,
} = require('@expo/config-plugins');
const path  = require('path');
const fs    = require('fs');

const WIDGET_NAME        = 'FuelogWidget';
const APP_GROUP          = 'group.com.zackschramm.macrolog';
// 17.0: the widget uses containerBackground(_:for:) and #Preview(as:), both iOS 17+.
// Extensions may require a newer OS than the host app (15.1).
const DEPLOYMENT_TARGET  = '17.0';
const SWIFT_FILES        = ['FuelogWidget.swift', 'FuelogWidgetBundle.swift'];

// ---------------------------------------------------------------------------
// Step 1: App Groups entitlement on the main target
// ---------------------------------------------------------------------------
function withAppGroupEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    const ents = c.modResults;
    const key  = 'com.apple.security.application-groups';
    const existing = ents[key] || [];
    if (!existing.includes(APP_GROUP)) {
      ents[key] = [...existing, APP_GROUP];
    }
    return c;
  });
}

// ---------------------------------------------------------------------------
// Step 2: Xcode project manipulation
// ---------------------------------------------------------------------------
function withWidgetXcodeTarget(config) {
  return withXcodeProject(config, (c) => {
    const project     = c.modResults;
    const projectRoot = c.modRequest.projectRoot;
    const iosDir      = path.join(projectRoot, 'ios');
    const srcDir      = path.join(projectRoot, 'targets', 'widget');
    const destDir     = path.join(iosDir, WIDGET_NAME);

    // --- Copy Swift / plist / entitlements into ios/FuelogWidget/ ---
    fs.mkdirSync(destDir, { recursive: true });
    if (fs.existsSync(srcDir)) {
      for (const file of fs.readdirSync(srcDir)) {
        if (/\.(swift|plist|entitlements)$/.test(file)) {
          fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        }
      }
    }

    // --- Guard: only add the target once ---
    const nativeTargetSection = project.pbxNativeTargetSection();
    const alreadyAdded = Object.values(nativeTargetSection).some(
      (t) => t && typeof t === 'object' && t.name === WIDGET_NAME
    );
    if (alreadyAdded) {
      console.log(`[withWidget] ${WIDGET_NAME} target already present – skipping.`);
      return c;
    }

    const bundleId = `${c.ios?.bundleIdentifier ?? 'com.zackschramm.macrolog'}.widget`;

    // node-xcode's addTargetDependency silently no-ops unless these sections
    // already exist, and Expo's single-target template doesn't have them.
    const objects = project.hash.project.objects;
    objects['PBXTargetDependency'] = objects['PBXTargetDependency'] || {};
    objects['PBXContainerItemProxy'] = objects['PBXContainerItemProxy'] || {};

    // --- Add the extension target ---
    // 'app_extension' → com.apple.product-type.app-extension
    // We patch the product type to widgetkit-extension below.
    // addTarget also creates the embed Copy Files phase on the main target
    // and the main-app → widget target dependency.
    const widgetTarget = project.addTarget(
      WIDGET_NAME,
      'app_extension',
      WIDGET_NAME,
      bundleId
    );

    // The new target starts with no build phases. These must exist before
    // addSourceFile below, or node-xcode falls back to the first 'Sources'
    // phase in the project — the main app's.
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', widgetTarget.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', widgetTarget.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', widgetTarget.uuid);

    // Patch product type to widgetkit-extension
    const updatedTargets = project.pbxNativeTargetSection();
    for (const key of Object.keys(updatedTargets)) {
      if (
        updatedTargets[key] &&
        typeof updatedTargets[key] === 'object' &&
        updatedTargets[key].name === WIDGET_NAME
      ) {
        updatedTargets[key].productType =
          '"com.apple.product-type.widgetkit-extension"';
      }
    }

    // Create a PBX group for widget source files and attach it to the main
    // project group so files appear correctly in the Xcode navigator.
    const { uuid: widgetGroupKey } = project.addPbxGroup([], WIDGET_NAME, WIDGET_NAME);
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    const mainGroup = project.getPBXGroupByKey(mainGroupKey);
    if (mainGroup) {
      mainGroup.children.push({ value: widgetGroupKey, comment: WIDGET_NAME });
    }

    // --- Add Swift source files to the widget target's Sources build phase ---
    // Bare filenames: the group's path already contributes the FuelogWidget/
    // directory, so a prefixed path would resolve to FuelogWidget/FuelogWidget/….
    for (const filename of SWIFT_FILES) {
      project.addSourceFile(
        filename,
        { target: widgetTarget.uuid },
        widgetGroupKey
      );
    }


    // --- Patch build settings for both Debug and Release configs ---
    const buildConfigs = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(buildConfigs)) {
      const bc = buildConfigs[key];
      if (
        !bc ||
        typeof bc !== 'object' ||
        !bc.buildSettings ||
        bc.buildSettings.PRODUCT_NAME !== `"${WIDGET_NAME}"`
      ) {
        continue;
      }
      Object.assign(bc.buildSettings, {
        SWIFT_VERSION:                    '5.0',
        IPHONEOS_DEPLOYMENT_TARGET:       DEPLOYMENT_TARGET,
        // Info.plist references $(MARKETING_VERSION)/$(CURRENT_PROJECT_VERSION);
        // undefined values produce an appex with empty version strings.
        MARKETING_VERSION:                c.version ?? '1.0.0',
        CURRENT_PROJECT_VERSION:          '1',
        TARGETED_DEVICE_FAMILY:           '"1"',
        INFOPLIST_FILE:                   `"${WIDGET_NAME}/Info.plist"`,
        CODE_SIGN_ENTITLEMENTS:           `"${WIDGET_NAME}/${WIDGET_NAME}.entitlements"`,
        SKIP_INSTALL:                     'YES',
        LD_RUNPATH_SEARCH_PATHS:
          '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
        SWIFT_EMIT_LOC_STRINGS:           'YES',
        ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES: 'NO',
      });
    }

    // --- Add WidgetKit.framework (weak) to the main app target ---
    const mainTarget = project.getFirstTarget();
    if (mainTarget) {
      project.addFramework('WidgetKit.framework', {
        weak: true,
        target: mainTarget.uuid,
      });
    }

    console.log(`[withWidget] Added ${WIDGET_NAME} extension target (bundle: ${bundleId})`);
    return c;
  });
}

// ---------------------------------------------------------------------------
// Podfile: disable code signing for resource bundle targets (Xcode 14+ fix)
// ---------------------------------------------------------------------------
function withResourceBundleCodeSigningFix(config) {
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const podfilePath = require('path').join(c.modRequest.platformProjectRoot, 'Podfile');
      let podfile = require('fs').readFileSync(podfilePath, 'utf-8');
      const MARKER = '    )\n  end\nend\n';
      const FIX = `    )\n    installer.pods_project.targets.each do |target|\n      if target.respond_to?(:product_type) && target.product_type == "com.apple.product-type.bundle"\n        target.build_configurations.each do |config|\n          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'\n        end\n      end\n    end\n  end\nend\n`;
      if (!podfile.includes('CODE_SIGNING_ALLOWED') && podfile.includes(MARKER)) {
        podfile = podfile.replace(MARKER, FIX);
        require('fs').writeFileSync(podfilePath, podfile);
      }
      return c;
    },
  ]);
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------
module.exports = function withWidget(config) {
  config = withAppGroupEntitlement(config);
  config = withWidgetXcodeTarget(config);
  config = withResourceBundleCodeSigningFix(config);
  return config;
};
