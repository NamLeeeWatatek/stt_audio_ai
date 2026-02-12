import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
    const {
        token,
        requiresRegistration,
        registrationAllowed,
        user,
        isInitialized,
        setToken,
        setUser,
        setRequiresRegistration,
        setRegistrationAllowed,
        setInitialized,
        logout: storeLogout
    } = useAuthStore();

    const isAuthenticated = !!token;

    const tokenCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const fetchWrapperSetupRef = useRef(false);

    const getAuthHeaders = useCallback((): Record<string, string> => {
        if (token) {
            return { Authorization: `Bearer ${token}` };
        }
        return {};
    }, [token]);

    // Memoize expensive token expiry check
    const isTokenExpired = useCallback((tokenToCheck: string): boolean => {
        try {
            const payload = JSON.parse(atob(tokenToCheck.split(".")[1]));
            const currentTime = Date.now() / 1000;
            // Check if token will expire in the next 5 minutes
            return payload.exp && payload.exp <= (currentTime + 300);
        } catch (error) {
            console.error("Invalid token format:", error);
            return true;
        }
    }, []);

    const logout = useCallback(() => {
        storeLogout();
        fetch("/api/v1/auth/logout", {
            method: "POST",
            headers: {
                "Authorization": token ? `Bearer ${token}` : "",
            },
        }).catch(() => { });

        if (window.location.pathname !== "/") {
            // Force navigation handled by RouterContext or window.location if critical
            window.history.pushState({ route: { path: 'home' } }, "", "/");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            window.dispatchEvent(new PopStateEvent('popstate', { state: { route: { path: 'home' } } as any }));
        }
    }, [token, storeLogout]);


    const login = useCallback(async (newToken: string) => {
        setToken(newToken);
        setRequiresRegistration(false);
        try {
            const res = await fetch("/api/v1/auth/me", {
                headers: { "Authorization": `Bearer ${newToken}` }
            });
            if (res.ok) {
                const data = await res.json();
                setUser(data.user);
            }
        } catch (err) {
            console.error("Failed to fetch user after login", err);
        }
    }, [setToken, setRequiresRegistration, setUser]);


    const tryRefresh = useCallback(async (): Promise<string | null> => {
        try {
            const res = await fetch('/api/v1/auth/refresh', { method: 'POST' })
            if (!res.ok) return null
            const data = await res.json()
            if (data?.token) {
                login(data.token)
                return data.token as string
            }
            return null
        } catch {
            return null
        }
    }, [login])


    // Consolidated token management
    useEffect(() => {
        if (!fetchWrapperSetupRef.current) {
            const originalFetch = window.fetch.bind(window);
            const wrappedFetch: typeof window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = input instanceof Request ? input.url : input.toString();
                if (url.includes('/api/v1/auth/refresh')) {
                    return originalFetch(input, init);
                }

                let res = await originalFetch(input, init);
                if (res.status === 401) {
                    const newToken = await tryRefresh()
                    if (newToken) {
                        const newInit: RequestInit | undefined = init ? { ...init } : undefined
                        if (newInit?.headers && typeof newInit.headers === 'object') {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            (newInit.headers as any)['Authorization'] = `Bearer ${newToken}`
                        }
                        res = await originalFetch(input, newInit)
                        if (res.status !== 401) return res
                    }
                    logout()
                }
                return res;
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            window.fetch = wrappedFetch as any;
            fetchWrapperSetupRef.current = true;
            return () => { window.fetch = originalFetch; };
        }

        if (tokenCheckIntervalRef.current) clearInterval(tokenCheckIntervalRef.current);

        if (token) {
            const checkTokenExpiry = async () => {
                if (!token) return;
                if (isTokenExpired(token)) {
                    const newToken = await tryRefresh();
                    if (!newToken) logout();
                }
            };
            tokenCheckIntervalRef.current = setInterval(checkTokenExpiry, 60000);
            checkTokenExpiry();
        }

        return () => {
            if (tokenCheckIntervalRef.current) clearInterval(tokenCheckIntervalRef.current);
        };
    }, [token, isTokenExpired, logout, tryRefresh]);

    // Initial check (equivalent to old AuthProvider mount effect)
    useEffect(() => {
        const initializeAuth = async () => {
            if (isInitialized) return; // Don't run if already initialized

            try {
                const response = await fetch("/api/v1/auth/registration-status");
                if (response.ok) {
                    const data = await response.json();
                    const regRequired = data.registration_required;
                    const regAllowed = data.registration_allowed;

                    setRequiresRegistration(regRequired);
                    setRegistrationAllowed(regAllowed);

                    if (!regRequired) {
                        // If token exists, always fetch/refresh user info to ensure role sync
                        if (token) {
                            const resMe = await fetch("/api/v1/auth/me", {
                                headers: { "Authorization": `Bearer ${token}` }
                            });
                            if (resMe.ok) {
                                const dataMe = await resMe.json();
                                setUser(dataMe.user);
                            } else if (resMe.status === 401) {
                                const refreshedToken = await tryRefresh();
                                if (!refreshedToken) logout();
                            }
                        }

                        // Check token validity if present
                        if (token && isTokenExpired(token)) {
                            // Try refresh or logout
                            const Refreshed = await tryRefresh();
                            if (!Refreshed) logout();
                        }
                    }
                }
            } catch (error) {
                console.error("Failed check reg status", error);
            } finally {
                setInitialized(true);
            }
        };
        initializeAuth();
    }, [isInitialized, setRequiresRegistration, setInitialized, token, isTokenExpired, tryRefresh, logout]);

    return {
        token,
        isAuthenticated,
        requiresRegistration,
        registrationAllowed,
        user,
        isAdmin: user?.role === 'admin',
        isInitialized,
        login,
        logout,
        getAuthHeaders
    };
}
