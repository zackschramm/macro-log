import WidgetKit
import SwiftUI

private let APP_GROUP = "group.com.zackschramm.macrolog"
private let DEFAULTS_KEY = "fuelogWidgetData"

// MARK: - Data model

struct MacroEntry: TimelineEntry {
    let date: Date
    let calories: Int
    let caloriesGoal: Int
    let protein: Double
    let proteinGoal: Double
    let carbs: Double
    let carbsGoal: Double
    let fat: Double
    let fatGoal: Double
    let dataDate: String
}

// MARK: - Timeline provider

struct FuelogProvider: TimelineProvider {
    func placeholder(in context: Context) -> MacroEntry {
        MacroEntry(
            date: Date(),
            calories: 1250, caloriesGoal: 2200,
            protein: 95,   proteinGoal: 150,
            carbs: 140,    carbsGoal: 250,
            fat: 45,       fatGoal: 70,
            dataDate: ""
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (MacroEntry) -> Void) {
        completion(readEntry() ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MacroEntry>) -> Void) {
        let entry = readEntry() ?? MacroEntry(
            date: Date(),
            calories: 0, caloriesGoal: 2000,
            protein: 0,  proteinGoal: 150,
            carbs: 0,    carbsGoal: 250,
            fat: 0,      fatGoal: 70,
            dataDate: ""
        )
        // Refresh every 30 minutes; the app also triggers reload via WidgetCenter
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func readEntry() -> MacroEntry? {
        guard
            let defaults  = UserDefaults(suiteName: APP_GROUP),
            let json      = defaults.string(forKey: DEFAULTS_KEY),
            let data      = json.data(using: .utf8),
            let dict      = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        return MacroEntry(
            date:          Date(),
            calories:      dict["calories"]     as? Int    ?? 0,
            caloriesGoal:  dict["caloriesGoal"] as? Int    ?? 2000,
            protein:       dict["protein"]      as? Double ?? 0,
            proteinGoal:   dict["proteinGoal"]  as? Double ?? 150,
            carbs:         dict["carbs"]        as? Double ?? 0,
            carbsGoal:     dict["carbsGoal"]    as? Double ?? 250,
            fat:           dict["fat"]          as? Double ?? 0,
            fatGoal:       dict["fatGoal"]      as? Double ?? 70,
            dataDate:      dict["date"]         as? String ?? ""
        )
    }
}

// MARK: - Brand colours

extension Color {
    static let fuelBg        = Color(red: 0.031, green: 0.035, blue: 0.043) // #08090B
    static let fuelTeal      = Color(red: 0.784, green: 1.000, blue: 0.239) // #C8FF3D (lime, matches website)
    static let fuelProtein   = Color(red: 0.310, green: 0.612, blue: 1.000) // #4F9CFF
    static let fuelCarbs     = Color(red: 0.961, green: 0.651, blue: 0.137) // #F5A623
    static let fuelFat       = Color(red: 0.957, green: 0.447, blue: 0.714) // #F472B6
    static let fuelText      = Color.white
    static let fuelMuted     = Color(white: 0.50)
}

// MARK: - Shared sub-views

struct CalorieRing: View {
    let calories: Int
    let goal: Int
    let ringSize: CGFloat
    let strokeWidth: CGFloat

    private var progress: Double {
        goal > 0 ? min(Double(calories) / Double(goal), 1.0) : 0
    }
    private var isOver: Bool { calories > goal }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.fuelTeal.opacity(0.15), lineWidth: strokeWidth)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    isOver ? Color.red : Color.fuelTeal,
                    style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            VStack(spacing: 1) {
                Text("\(calories)")
                    .font(.system(size: ringSize * 0.22, weight: .bold, design: .rounded))
                    .foregroundColor(.fuelText)
                Text("cal")
                    .font(.system(size: ringSize * 0.12, weight: .medium))
                    .foregroundColor(.fuelMuted)
            }
        }
        .frame(width: ringSize, height: ringSize)
    }
}

struct MacroBar: View {
    let label: String
    let value: Double
    let goal: Double
    let color: Color

    private var progress: Double {
        goal > 0 ? min(value / goal, 1.0) : 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 0) {
                Text(label)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(color)
                Spacer()
                Text("\(Int(value))g")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.fuelMuted)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color.opacity(0.18))
                        .frame(height: 4)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(color)
                        .frame(width: geo.size.width * progress, height: 4)
                }
            }
            .frame(height: 4)
        }
    }
}

// MARK: - Small widget (2×2)

struct SmallWidgetView: View {
    let entry: MacroEntry

    private var remaining: Int { max(entry.caloriesGoal - entry.calories, 0) }
    private var isOver: Bool   { entry.calories > entry.caloriesGoal }

    var body: some View {
        ZStack {
            Color.fuelBg
            VStack(spacing: 6) {
                CalorieRing(
                    calories: entry.calories,
                    goal: entry.caloriesGoal,
                    ringSize: 72,
                    strokeWidth: 8
                )
                Text(isOver ? "OVER GOAL" : "\(remaining) left")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(isOver ? .red : .fuelMuted)
                    .lineLimit(1)
                Text("FUELOG")
                    .font(.system(size: 8, weight: .heavy))
                    .foregroundColor(Color.fuelTeal.opacity(0.65))
                    .kerning(1.5)
            }
            .padding(10)
        }
    }
}

// MARK: - Medium widget (2×4)

struct MediumWidgetView: View {
    let entry: MacroEntry

    private var remaining: Int { max(entry.caloriesGoal - entry.calories, 0) }
    private var isOver: Bool   { entry.calories > entry.caloriesGoal }

    var body: some View {
        ZStack {
            Color.fuelBg
            HStack(spacing: 14) {
                // Left column: calorie ring + wordmark
                VStack(spacing: 5) {
                    CalorieRing(
                        calories: entry.calories,
                        goal: entry.caloriesGoal,
                        ringSize: 66,
                        strokeWidth: 7
                    )
                    Text(isOver ? "OVER" : "\(remaining) left")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(isOver ? .red : .fuelMuted)
                        .lineLimit(1)
                    Text("FUELOG")
                        .font(.system(size: 7, weight: .heavy))
                        .foregroundColor(Color.fuelTeal.opacity(0.65))
                        .kerning(1.5)
                }

                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 1)

                // Right column: macro bars
                VStack(alignment: .leading, spacing: 9) {
                    MacroBar(label: "P", value: entry.protein, goal: entry.proteinGoal, color: .fuelProtein)
                    MacroBar(label: "C", value: entry.carbs,   goal: entry.carbsGoal,   color: .fuelCarbs)
                    MacroBar(label: "F", value: entry.fat,     goal: entry.fatGoal,     color: .fuelFat)
                }
                .frame(maxWidth: .infinity)
            }
            .padding(13)
        }
    }
}

// MARK: - Entry view + widget definition

struct FuelogWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MacroEntry

    var body: some View {
        switch family {
        case .systemMedium:
            MediumWidgetView(entry: entry)
        default:
            SmallWidgetView(entry: entry)
        }
    }
}

struct FuelogWidget: Widget {
    let kind = "FuelogWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: FuelogProvider()) { entry in
            FuelogWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Fuelog Macros")
        .description("Today's calorie and macro progress at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
