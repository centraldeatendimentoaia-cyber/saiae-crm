'use client';

import { errorMessage } from "@/lib/errors";
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Bot, ArrowRight, Loader2 } from "lucide-react";
import Link from 'next/link';
import { BrandLogo } from "@/components/brand-logo";

const formSchema = z.object({
    name: z.string().min(2, "O nome precisa ter pelo menos 2 caracteres"),
    email: z.string().email("Digite um e-mail válido"),
    password: z.string().min(6, "A senha precisa ter pelo menos 6 caracteres"),
    confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
});

export default function RegisterPage() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            email: "",
            password: "",
            confirmPassword: ""
        },
    });

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: values.name,
                    email: values.email,
                    password: values.password,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Falha ao criar a conta");
            }

            setSuccess(true);
            setTimeout(() => {
                router.push('/auth/login');
            }, 2000);

        } catch (err) {
            setError(errorMessage(err, "Ocorreu um erro inesperado"));
        } finally {
            setLoading(false);
        }
    }

    if (success) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-background relative overflow-hidden">
                <div className="glass-panel p-10 rounded-3xl flex flex-col items-center text-center max-w-sm animate-in zoom-in duration-500">
                    <div className="h-16 w-16 bg-zinc-500 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-zinc-500/30">
                        <Bot className="h-8 w-8 text-white" />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground mb-2">Cadastro realizado com sucesso!</h2>
                    <p className="text-muted-foreground">Redirecionando para a tela de login...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-screen relative overflow-hidden bg-background py-12">

            <div className="relative z-10 w-full max-w-md p-4 animate-in fade-in zoom-in-95 duration-500">
                <div className="flex flex-col items-center mb-8">
                    <BrandLogo crm className="h-14 mb-6" />
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">Criar conta</h1>
                    <p className="text-muted-foreground mt-2">Junte-se à Saiaê</p>
                </div>

                <div className="bg-card rounded-[24px] p-8">
                    {error && (
                        <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center font-medium animate-in shake duration-300">
                            {error}
                        </div>
                    )}

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-foreground/80">Nome completo</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Maria Silva"
                                                className="font-medium"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="email"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-foreground/80">E-mail</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="nome@exemplo.com"
                                                className="font-medium"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="password"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-foreground/80">Senha</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="password"
                                                placeholder="••••••••"
                                                className="font-medium"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="confirmPassword"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-foreground/80">Confirmar senha</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="password"
                                                placeholder="••••••••"
                                                className="font-medium"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <Button
                                type="submit"
                                size="lg"
                                className="w-full h-12 rounded-xl text-base shadow-lg shadow-primary/20 hover:shadow-primary/30 mt-4"
                                disabled={loading}
                            >
                                {loading ? (
                                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" />  Criando conta...</>
                                ) : (
                                    <>Cadastrar <ArrowRight className="ml-2 h-5 w-5" /></>
                                )}
                            </Button>
                        </form>
                    </Form>

                    <div className="mt-6 text-xs text-center text-muted-foreground leading-relaxed">
                        
                        Ao se cadastrar, você concorda com nossos <Link href="/terms" className="underline hover:text-foreground">Termos de Serviço</Link>  e <Link href="/privacy" className="underline hover:text-foreground">Política de Privacidade</Link>.
                    </div>
                </div>

                <div className="mt-8 text-center text-sm text-muted-foreground">
                    
                    Já tem uma conta?{" "}
                    <Link href="/auth/login" className="font-semibold text-foreground underline underline-offset-4 hover:text-foreground/70 transition-colors">
                        
                        Entrar
                    </Link>
                </div>
            </div>
        </div>
    );
}
