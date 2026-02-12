import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Shield, User, Trash2, UserCog, Loader2, AlertCircle, CheckCircle2, Grip } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface UserInfo {
    id: number;
    username: string;
    full_name: string;
    role: string;
    created_at: string;
}

export function UserManagement() {
    const { isAdmin, token } = useAuth();
    const [users, setUsers] = useState<UserInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/admin/users", {
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setUsers(data);
            } else {
                setError("Failed to fetch users");
            }
        } catch (err) {
            setError("Network error fetching users");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin) {
            fetchUsers();
        }
    }, [isAdmin, token]);

    const handleRoleUpdate = async (userId: number, currentRole: string) => {
        const newRole = currentRole === 'admin' ? 'user' : 'admin';
        try {
            const res = await fetch(`/api/v1/admin/users/${userId}/role`, {
                method: "PUT",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ role: newRole })
            });
            if (res.ok) {
                setSuccess(`User role updated to ${newRole}`);
                fetchUsers();
                setTimeout(() => setSuccess(""), 3000);
            }
        } catch (err) {
            setError("Failed to update role");
        }
    };

    const handleDeleteUser = async (userId: number) => {
        if (!confirm("Are you sure you want to delete this user? This action cannot be undone.")) return;

        try {
            const res = await fetch(`/api/v1/admin/users/${userId}`, {
                method: "DELETE",
                headers: { "Authorization": `Bearer ${token}` }
            });
            if (res.ok) {
                setSuccess("User deleted successfully");
                setUsers(users.filter(u => u.id !== userId));
                setTimeout(() => setSuccess(""), 3000);
            } else {
                const data = await res.json();
                setError(data.error || "Failed to delete user");
                setTimeout(() => setError(""), 3000);
            }
        } catch (err) {
            setError("Failed to delete user");
        }
    };

    if (!isAdmin) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center">
                <Shield className="w-16 h-16 text-red-500 mb-4 opacity-20" />
                <h2 className="text-2xl font-bold text-[var(--text-primary)]">Access Denied</h2>
                <p className="text-[var(--text-secondary)] mt-2">Only administrators can access this page.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold text-[var(--text-primary)] tracking-tight">User Management</h2>
                    <p className="text-[var(--text-secondary)] mt-1">Manage user accounts and administrative roles</p>
                </div>
                <Button
                    variant="outline"
                    onClick={fetchUsers}
                    disabled={loading}
                    className="border-[var(--border-subtle)] hover:bg-[var(--secondary)]"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Grip className="w-4 h-4 mr-2" />}
                    Refresh List
                </Button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-4 rounded-xl flex items-center gap-3">
                    <AlertCircle className="w-5 h-5" />
                    {error}
                </div>
            )}

            {success && (
                <div className="bg-green-500/10 border border-green-500/20 text-green-600 p-4 rounded-xl flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5" />
                    {success}
                </div>
            )}

            <div className="grid gap-4">
                {loading && users.length === 0 ? (
                    <div className="p-12 text-center text-[var(--text-tertiary)] bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] border-dashed">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
                        Loading users...
                    </div>
                ) : users.length === 0 ? (
                    <div className="p-12 text-center text-[var(--text-tertiary)] bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] border-dashed">
                        <User className="w-8 h-8 mx-auto mb-4 opacity-20" />
                        No users found.
                    </div>
                ) : (
                    users.map(user => (
                        <Card key={user.id} className="glass shadow-none border-[var(--border-subtle)] overflow-hidden hover:border-[var(--brand-solid)]/30 transition-all duration-300">
                            <CardContent className="p-0">
                                <div className="flex items-center justify-between p-5">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-gradient-to-br from-[var(--secondary)] to-[var(--bg-main)] rounded-2xl flex items-center justify-center border border-[var(--border-subtle)]">
                                            <User className="w-6 h-6 text-[var(--text-secondary)]" />
                                        </div>
                                        <div>
                                            <div className="font-semibold text-[var(--text-primary)] text-lg">{user.username}</div>
                                            <div className="text-sm text-[var(--text-tertiary)] flex items-center gap-2">
                                                {user.full_name || "No name set"}
                                                <span className="opacity-20">•</span>
                                                {new Date(user.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div
                                            className={`px-2 py-1 rounded-full text-[10px] font-bold tracking-wider ${user.role === 'admin'
                                                    ? "bg-amber-500 text-white"
                                                    : "bg-[var(--secondary)] text-[var(--text-secondary)]"
                                                }`}
                                        >
                                            {user.role.toUpperCase()}
                                        </div>

                                        <div className="flex border-l border-[var(--border-subtle)] ml-2 pl-4 gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleRoleUpdate(user.id, user.role)}
                                                className="text-[var(--text-secondary)] hover:text-[var(--brand-solid)] hover:bg-[var(--brand-light)]"
                                                title={user.role === 'admin' ? "Demote to User" : "Promote to Admin"}
                                            >
                                                <UserCog className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDeleteUser(user.id)}
                                                className="text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-50"
                                                title="Delete User"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
