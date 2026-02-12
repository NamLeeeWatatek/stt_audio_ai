import { useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { Login } from "@/features/auth/components/Login";
import { Register } from "@/features/auth/components/Register";

interface ProtectedRouteProps {
	children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
	const { isAuthenticated, requiresRegistration, registrationAllowed, isInitialized, login } = useAuth();
	const [mode, setMode] = useState<"login" | "register">("login");

	// Show loading while initializing
	if (!isInitialized) {
		return (
			<div className="min-h-screen bg-carbon-50 dark:bg-carbon-900 flex items-center justify-center">
				<div className="text-center">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
					<p className="mt-2 text-carbon-600 dark:text-carbon-400">Loading...</p>
				</div>
			</div>
		);
	}

	// Show registration form if no users exist
	if (requiresRegistration) {
		return <Register onRegister={login} />;
	}

	// Show login or register form if not authenticated
	if (!isAuthenticated) {
		if (mode === "register" && registrationAllowed) {
			return <Register onRegister={login} onSwitchToLogin={() => setMode("login")} />;
		}
		return <Login onLogin={login} onSwitchToRegister={registrationAllowed ? () => setMode("register") : undefined} />;
	}

	// Show protected content if authenticated
	return <>{children}</>;
}