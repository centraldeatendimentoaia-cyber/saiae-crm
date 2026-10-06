"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, Edit, User, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface UserProfile {
    id: string;
    name: string | null;
    email: string;
    role: "SUPERADMIN" | "OWNER" | "STAFF";
    createdAt: string;
    _count?: {
        sessions: number;
    }
}

export default function UsersPage() {
    const { data: session } = useSession();
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [editingUser, setEditingUser] = useState<UserProfile | null>(null);

    // Form state
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        role: "OWNER"
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await fetch("/api/users");
            if (res.ok) {
                const responseData = await res.json();
                setUsers(responseData?.data || []);
            } else if (res.status === 403) {
                toast.error("Não autorizado. Somente o Super Admin pode ver os usuários.");
            }
        } catch (error) {
            console.error("Failed to fetch users", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            const url = editingUser ? `/api/users/${editingUser.id}` : "/api/users";
            const method = editingUser ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                toast.success(editingUser ? "User updated" : "User created");
                setShowForm(false);
                setEditingUser(null);
                setFormData({ name: "", email: "", password: "", role: "OWNER" });
                fetchUsers();
            } else {
                const error = await res.json();
                toast.error(error.error || "Operation failed");
            }
        } catch (error) {
            toast.error("A operação falhou");
        }
    };

    const [deleteId, setDeleteId] = useState<string | null>(null);

    const handleDelete = async (id: string) => {
        setDeleteId(id);
    };

    const confirmDelete = async () => {
        if (!deleteId) return;

        try {
            const res = await fetch(`/api/users/${deleteId}`, { method: "DELETE" });
            if (res.ok) {
                toast.success("Usuário excluído");
                fetchUsers();
            } else {
                const error = await res.json();
                toast.error(error.error || "Failed to delete");
            }
        } catch (error) {
            toast.error("Falha ao excluir o usuário");
        } finally {
            setDeleteId(null);
        }
    };

    const getRoleIcon = (role: string) => {
        switch (role) {
            case "SUPERADMIN": return <ShieldAlert className="h-4 w-4 text-red-500" />;
            case "OWNER": return <ShieldCheck className="h-4 w-4 text-zinc-500" />;
            default: return <User className="h-4 w-4 text-zinc-500" />;
        }
    };

    if (loading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

    // TODO: Improve RBAC check here if strictly needed, but API protects it.
    // If empty list and not loading, likely unauthorized or empty.

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                        <UsersIcon className="h-5 w-5 sm:h-6 sm:w-6" />  Gerenciamento de usuários
                    </h1>
                    <p className="text-sm text-muted-foreground">Gerencie usuários e permissões</p>
                </div>
                <Button size="sm" onClick={() => {
                    setEditingUser(null);
                    setFormData({ name: "", email: "", password: "", role: "OWNER" });
                    setShowForm(true);
                }}>
                    <Plus className="h-4 w-4 mr-1 sm:mr-2" />  Adicionar usuário
                </Button>
            </div>

            {/* User Form Modal/Card */}
            {showForm && (
                <Card className="border-2 border-primary/20">
                    <CardHeader>
                        <CardTitle>{editingUser ? "Editar usuário" : "Novo usuário"}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                <div className="space-y-2">
                                    <Label>Nome</Label>
                                    <Input
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>E-mail</Label>
                                    <Input
                                        type="email"
                                        value={formData.email}
                                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                <div className="space-y-2">
                                    <Label>{editingUser ? "Nova senha (deixe em branco para manter)" : "Senha"}</Label>
                                    <Input
                                        type="password"
                                        value={formData.password}
                                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                                        required={!editingUser}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Função</Label>
                                    <Select
                                        value={formData.role}
                                        onValueChange={(v: string) => setFormData({ ...formData, role: v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="SUPERADMIN">Super Admin</SelectItem>
                                            <SelectItem value="OWNER">Proprietário</SelectItem>
                                            <SelectItem value="STAFF">Equipe</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
                                <Button type="submit">{editingUser ? "Atualizar" : "Criar"}</Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            )}

            {/* Users Table */}
            <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {users.map(user => (
                    <Card key={user.id} className="overflow-hidden">
                        <CardContent className="p-0">
                            <div className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-zinc-100 flex items-center justify-center font-bold text-zinc-500">
                                            {user.name?.charAt(0) || user.email.charAt(0)}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold">{user.name || "Usuário"}</h3>
                                            <p className="text-xs text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="flex items-center gap-1">
                                        {getRoleIcon(user.role)}
                                        {user.role}
                                    </Badge>
                                </div>

                                <div className="flex justify-between items-center text-sm text-muted-foreground">
                                    <span>{user._count?.sessions || 0}  Sessões</span>
                                    <span>Cadastro {new Date(user.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>
                            <div className="bg-zinc-50 p-3 flex justify-end gap-2 border-t">
                                <Button size="sm" variant="ghost" onClick={() => {
                                    setEditingUser(user);
                                    setFormData({
                                        name: user.name || "",
                                        email: user.email,
                                        password: "",
                                        role: user.role
                                    });
                                    setShowForm(true);
                                }}>
                                    <Edit className="h-4 w-4 mr-1" />  Editar
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(user.id)}>
                                    <Trash2 className="h-4 w-4 mr-1" />  Excluir
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
            {/* Confirmation Dialog */}
            <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Tem certeza absoluta?</AlertDialogTitle>
                        <AlertDialogDescription>
                            
                            Esta ação não pode ser desfeita. O usuário será excluído permanentemente e seus dados removidos dos nossos servidores.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Continuar</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function UsersIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    )
}
