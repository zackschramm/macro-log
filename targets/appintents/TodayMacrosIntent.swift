import AppIntents
import Foundation

private let FUELOG_APP_GROUP = "group.com.zackschramm.macrolog"
private let WIDGET_DATA_KEY = "fuelogWidgetData"

// "What are my macros today?" — answered entirely from the App Group snapshot
// that LogScreen already writes on every log change (see utils/widgetSync.ts),
// so this runs without launching the app.
@available(iOS 16.0, *)
struct TodayMacrosIntent: AppIntent {
    static var title: LocalizedStringResource = "Today's Macros"
    static var description = IntentDescription("Reads back today's calories and macros logged in Fuelog.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard
            let defaults = UserDefaults(suiteName: FUELOG_APP_GROUP),
            let json = defaults.string(forKey: WIDGET_DATA_KEY),
            let data = json.data(using: .utf8),
            let summary = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return .result(dialog: "You haven't logged anything in Fuelog today yet.")
        }

        let today = String(ISO8601DateFormatter().string(from: Date()).prefix(10))
        let loggedDate = summary["date"] as? String
        guard loggedDate == today else {
            return .result(dialog: "You haven't logged anything in Fuelog today yet.")
        }

        func number(_ key: String) -> Double {
            (summary[key] as? NSNumber)?.doubleValue ?? 0
        }

        let calories = Int(number("calories").rounded())
        let caloriesGoal = Int(number("caloriesGoal").rounded())
        let protein = formatGrams(number("protein"))
        let carbs = formatGrams(number("carbs"))
        let fat = formatGrams(number("fat"))

        let dialog = "You've had \(calories) of \(caloriesGoal) calories today — \(protein)g protein, \(carbs)g carbs, \(fat)g fat."
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }

    private func formatGrams(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }
}
