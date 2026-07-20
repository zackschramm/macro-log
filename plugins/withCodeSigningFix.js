const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

module.exports = function withCodeSigningFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      const injection = `
    installer.target_installation_results.pod_target_installation_results.each do |pod_name, target_installation_result|
      target_installation_result.resource_bundle_targets.each do |resource_bundle_target|
        resource_bundle_target.build_configurations.each do |config|
          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        end
      end
    end
`;

      if (!contents.includes("CODE_SIGNING_ALLOWED") && /post_install do \|installer\|/.test(contents)) {
        contents = contents.replace(
          /post_install do \|installer\|/,
          `post_install do |installer|\n${injection}`
        );
        fs.writeFileSync(podfilePath, contents);
      }

      return cfg;
    },
  ]);
};
