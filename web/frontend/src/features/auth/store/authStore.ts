import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
    token: string | null;
    isAuthenticated: boolean;
    requiresRegistration: boolean;
    registrationAllowed: boolean;
    user: any | null;
    isInitialized: boolean;
    setToken: (token: string | null) => void;
    setUser: (user: any | null) => void;
    setRequiresRegistration: (requires: boolean) => void;
    setRegistrationAllowed: (allowed: boolean) => void;
    setInitialized: (initialized: boolean) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            token: null,
            isAuthenticated: false,
            requiresRegistration: false,
            registrationAllowed: false,
            user: null,
            isInitialized: false,
            setToken: (token) => set({ token, isAuthenticated: !!token }),
            setUser: (user) => set({ user }),
            setRequiresRegistration: (requires) => set({ requiresRegistration: requires }),
            setRegistrationAllowed: (allowed) => set({ registrationAllowed: allowed }),
            setInitialized: (initialized) => set({ isInitialized: initialized }),
            logout: () => {
                set({ token: null, isAuthenticated: false, user: null });
                localStorage.removeItem('auth-storage');
                // Optional: Call logout endpoint if needed, but side effects strictly in hooks/components usually better
            },
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({ token: state.token, user: state.user }), // Persist token and user role
        }
    )
);
