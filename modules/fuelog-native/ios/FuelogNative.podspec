require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'FuelogNative'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.author         = 'Zack Schramm'
  s.homepage       = 'https://github.com/zackschramm/macro-log'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # FoundationModels only exists on iOS 26+ SDKs; weak-link so the app still
  # loads on the 15.1 deployment target (same pattern as AppIntents).
  s.weak_frameworks = 'FoundationModels'

  s.source_files = '**/*.{h,m,swift}'
end
