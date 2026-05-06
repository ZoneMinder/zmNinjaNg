/**
 * Theme Provider Component
 *
 * Manages the application's theme (light, dark, system) using React Context.
 * Persists the theme preference to localStorage and applies the corresponding
 * CSS class to the document root.
 */

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react"
import { useProfileStore } from '../stores/profile';
import { useSettingsStore, type ThemePreference } from '../stores/settings';
import { syncNativeWindowBackground } from '../lib/native-window-theme';

type Theme = ThemePreference

type ThemeProviderProps = {
    children: React.ReactNode
    defaultTheme?: Theme
}

type ThemeProviderState = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
    theme: "system",
    setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

/**
 * ThemeProvider component that wraps the application to provide theme context.
 *
 * @param props - Component properties
 * @param props.children - Child components
 * @param props.defaultTheme - Default theme to use if not stored (default: "system")
 * @param props.storageKey - Key to use for localStorage (default: "vite-ui-theme")
 */
export function ThemeProvider({
    children,
    defaultTheme = "system",
}: ThemeProviderProps) {
    const currentProfileId = useProfileStore((state) => state.currentProfileId);
    // Select theme directly from profileSettings to avoid calling getProfileSettings()
    // which creates a new object on each call and causes infinite re-renders
    const profileTheme = useSettingsStore(
        (state) => (currentProfileId ? state.profileSettings[currentProfileId]?.theme : undefined)
    );
    const updateProfileSettings = useSettingsStore((state) => state.updateProfileSettings);
    const resolvedDefault = useMemo(() => profileTheme || defaultTheme, [defaultTheme, profileTheme]);
    const [theme, setTheme] = useState<Theme>(resolvedDefault);

    useEffect(() => {
        if (profileTheme && profileTheme !== theme) {
            setTheme(profileTheme);
        }
    }, [profileTheme, theme]);

    useEffect(() => {
        const root = window.document.documentElement

        root.classList.remove("light", "dark", "slate", "amber", "cream")

        if (theme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
                .matches
                ? "dark"
                : "light"

            root.classList.add(systemTheme)
            return
        }

        if (theme === "slate" || theme === "amber") {
            root.classList.add("dark", theme)
        } else {
            root.classList.add(theme)
        }

        syncNativeWindowBackground()
    }, [theme])

    const handleSetTheme = useCallback((newTheme: Theme) => {
        setTheme(newTheme)
        if (currentProfileId) {
            updateProfileSettings(currentProfileId, { theme: newTheme });
        }
    }, [currentProfileId, updateProfileSettings]);

    const value = useMemo(() => ({
        theme,
        setTheme: handleSetTheme,
    }), [theme, handleSetTheme]);

    return (
        <ThemeProviderContext.Provider {...value} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    )
}

/**
 * Hook to access the theme context.
 *
 * @returns The current theme state and setter
 * @throws Error if used outside of a ThemeProvider
 */
export const useTheme = () => {
    const context = useContext(ThemeProviderContext)

    if (context === undefined)
        throw new Error("useTheme must be used within a ThemeProvider")

    return context
}
