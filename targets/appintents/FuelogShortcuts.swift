import AppIntents

@available(iOS 16.0, *)
struct FuelogShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogFoodIntent(),
            phrases: [
                // Siri phrase parameters must be AppEntity/AppEnum — `food` is a
                // free-text String, so it can't be captured here. iOS will
                // prompt for it after the phrase matches.
                "Log food in \(.applicationName)",
                "Add food to \(.applicationName)",
            ],
            shortTitle: "Log Food",
            systemImageName: "fork.knife"
        )
        AppShortcut(
            intent: TodayMacrosIntent(),
            phrases: [
                "What are my macros today in \(.applicationName)",
                "What's my macro total in \(.applicationName)",
                "Check my macros in \(.applicationName)",
            ],
            shortTitle: "Today's Macros",
            systemImageName: "chart.pie"
        )
    }
}
