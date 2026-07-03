import AppIntents
import Foundation

private let FUELOG_APP_GROUP = "group.com.zackschramm.macrolog"
private let PENDING_FOOD_KEY = "fuelogPendingFoodLog"
private let PENDING_FOOD_TIMESTAMP_KEY = "fuelogPendingFoodLogTimestamp"

// "Log <food> in Fuelog" — hands the food description to the app so it can be
// confirmed against AI-estimated macros. Actual parsing needs a network call,
// so this intent just opens the app with the food pre-filled rather than
// logging in the background.
@available(iOS 16.0, *)
struct LogFoodIntent: AppIntent {
    static var title: LocalizedStringResource = "Log Food in Fuelog"
    static var description = IntentDescription(
        "Opens Fuelog to log a food, with the description pre-filled so you can confirm the macros."
    )
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Food")
    var food: String

    static var parameterSummary: some ParameterSummary {
        Summary("Log \(\.$food) in Fuelog")
    }

    func perform() async throws -> some IntentResult {
        if let defaults = UserDefaults(suiteName: FUELOG_APP_GROUP) {
            defaults.set(food, forKey: PENDING_FOOD_KEY)
            defaults.set(Date().timeIntervalSince1970, forKey: PENDING_FOOD_TIMESTAMP_KEY)
        }
        return .result()
    }
}
