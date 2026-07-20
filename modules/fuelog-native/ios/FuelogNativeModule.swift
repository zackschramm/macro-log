import ExpoModulesCore
import WidgetKit
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

private let APP_GROUP   = "group.com.zackschramm.macrolog"
private let DEFAULTS_KEY = "fuelogWidgetData"
private let PENDING_FOOD_KEY = "fuelogPendingFoodLog"
private let PENDING_FOOD_TIMESTAMP_KEY = "fuelogPendingFoodLogTimestamp"

public class FuelogNativeModule: Module {
    public func definition() -> ModuleDefinition {
        Name("FuelogNative")

        // Write today's macro summary to the shared App Group container and
        // tell WidgetKit to reload immediately.
        AsyncFunction("writeWidgetData") { (data: [String: Any]) in
            guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
            if let bytes = try? JSONSerialization.data(withJSONObject: data),
               let json  = String(data: bytes, encoding: .utf8) {
                defaults.set(json, forKey: DEFAULTS_KEY)
                defaults.synchronize()
            }
            DispatchQueue.main.async {
                WidgetCenter.shared.reloadAllTimelines()
            }
        }

        // Reads the food description handed off by the "Log <food> in Fuelog"
        // App Intent (see targets/appintents/LogFoodIntent.swift), if any, and
        // clears it so it isn't replayed on a later launch.
        AsyncFunction("getPendingFoodLog") { () -> [String: Any]? in
            guard
                let defaults = UserDefaults(suiteName: APP_GROUP),
                let food = defaults.string(forKey: PENDING_FOOD_KEY)
            else { return nil }
            let timestamp = defaults.double(forKey: PENDING_FOOD_TIMESTAMP_KEY)
            defaults.removeObject(forKey: PENDING_FOOD_KEY)
            defaults.removeObject(forKey: PENDING_FOOD_TIMESTAMP_KEY)
            return ["food": food, "timestamp": timestamp]
        }

        // MARK: - On-device AI (Apple Foundation Models, iOS 26+)

        // True only when the device has Apple Intelligence's on-device model
        // ready to use (iOS 26+, supported hardware, model downloaded).
        AsyncFunction("isLocalAIAvailable") { () -> Bool in
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                switch SystemLanguageModel.default.availability {
                case .available: return true
                default: return false
                }
            }
            #endif
            return false
        }

        // Runs a single prompt through the on-device model and returns the
        // generated text. Throws on any failure — the JS layer falls back to
        // the ai-proxy edge function, so errors here are never user-facing.
        AsyncFunction("generateLocalAI") { (prompt: String, system: String?, maxTokens: Int) -> String in
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                guard case .available = SystemLanguageModel.default.availability else {
                    throw NSError(domain: "FuelogNative", code: 1,
                                  userInfo: [NSLocalizedDescriptionKey: "Local model unavailable"])
                }
                let session = (system?.isEmpty == false)
                    ? LanguageModelSession(instructions: system!)
                    : LanguageModelSession()
                let options = GenerationOptions(maximumResponseTokens: maxTokens)
                let response = try await session.respond(to: prompt, options: options)
                return response.content
            }
            #endif
            throw NSError(domain: "FuelogNative", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Local AI requires iOS 26+"])
        }
    }
}
