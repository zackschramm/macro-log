/**
 * withSiriShortcuts.js
 *
 * Expo config plugin that adds App Intents-based Siri Shortcuts to the main
 * app target during expo prebuild / EAS Build.
 *
 * Unlike the old NSUserActivity donation approach, App Intents don't require
 * the app to have run first — Siri (including the LLM-based Siri on iOS 26+)
 * discovers `LogFoodIntent` / `TodayMacrosIntent` via the AppShortcutsProvider
 * declared in FuelogShortcuts.swift as soon as the app is installed.
 *
 * What it does:
 *  1. Copies the App Intents Swift sources from targets/appintents/ into
 *     ios/Fuelog/AppIntents/.
 *  2. Adds those files to the main app target's Sources build phase (App
 *     Intents metadata extraction only runs against the target the intents
 *     are compiled into — a separate extension isn't required here since
 *     neither intent needs to run detached from the main process).
 *  3. Weak-links AppIntents.framework so the app still builds down to the
 *     15.1 deployment target — the intent types themselves are guarded with
 *     @available(iOS 16.0, *) and Siri simply won't offer them below iOS 16.
 *  4. Adds NSSiriUsageDescription to Info.plist (required by App Store
 *     Review) and keeps the com.apple.developer.siri entitlement enabled on
 *     the main app ID in the Apple Developer portal.
 */

const { withInfoPlist, withEntitlementsPlist, withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const GROUP_NAME = 'AppIntents';
const SWIFT_FILES = ['LogFoodIntent.swift', 'TodayMacrosIntent.swift', 'FuelogShortcuts.swift'];

const SIRI_DESCRIPTION =
  'Fuelog uses Siri to let you log food and hear your macros with your voice.';

// ---------------------------------------------------------------------------
// Info.plist
// ---------------------------------------------------------------------------
function withSiriInfoPlist(config) {
  return withInfoPlist(config, (c) => {
    const plist = c.modResults;
    plist.NSSiriUsageDescription = SIRI_DESCRIPTION;
    // NSUserActivityTypes was only needed for the old donation-based
    // shortcuts; App Intents are discovered via AppShortcutsProvider instead.
    delete plist.NSUserActivityTypes;
    return c;
  });
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------
function withSiriEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    c.modResults['com.apple.developer.siri'] = true;
    return c;
  });
}

// ---------------------------------------------------------------------------
// Xcode project: copy + register the App Intents sources on the main target
// ---------------------------------------------------------------------------
function withAppIntentsXcodeSources(config) {
  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    const projectRoot = c.modRequest.projectRoot;
    const srcDir = path.join(projectRoot, 'targets', 'appintents');
    const iosProjectName = c.modRequest.projectName ?? 'Fuelog';
    const destDir = path.join(projectRoot, 'ios', iosProjectName, GROUP_NAME);

    fs.mkdirSync(destDir, { recursive: true });
    for (const file of SWIFT_FILES) {
      const src = path.join(srcDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(destDir, file));
      }
    }

    const mainTarget = project.getFirstTarget();
    if (!mainTarget) return c;

    // Guard: only add the group/sources once per prebuild.
    const existingGroup = project.pbxGroupByName(GROUP_NAME);
    if (existingGroup) {
      return c;
    }

    // Group path must be relative to SRCROOT (ios/), not to the Fuelog app
    // group, since we attach this group directly under the project's root
    // group below — otherwise Xcode looks for the sources at ios/AppIntents
    // instead of where they were actually copied (ios/Fuelog/AppIntents).
    const groupPath = `${iosProjectName}/${GROUP_NAME}`;
    const { uuid: groupKey } = project.addPbxGroup([], GROUP_NAME, groupPath);
    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    const mainGroup = project.getPBXGroupByKey(mainGroupKey);
    if (mainGroup) {
      mainGroup.children.push({ value: groupKey, comment: GROUP_NAME });
    }

    for (const file of SWIFT_FILES) {
      project.addSourceFile(file, { target: mainTarget.uuid }, groupKey);
    }

    // AppIntents is a system framework available since iOS 16; weak-link so
    // the app still links on the 15.1 deployment target.
    project.addFramework('AppIntents.framework', { weak: true, target: mainTarget.uuid });

    console.log('[withSiriShortcuts] Added App Intents sources to the main target.');
    return c;
  });
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------
module.exports = function withSiriShortcuts(config) {
  config = withSiriInfoPlist(config);
  config = withSiriEntitlement(config);
  config = withAppIntentsXcodeSources(config);
  return config;
};
