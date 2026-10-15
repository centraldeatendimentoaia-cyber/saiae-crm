'use client';

import { useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  email: z.string().email("Digite um e-mail válido"),
  password: z.string().min(1, "Informe a senha"),
});

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    setError(null);
    try {
      const result = await signIn('credentials', {
        redirect: false,
        email: values.email,
        password: values.password,
      });

      if (result?.error) {
        setError("E-mail ou senha inválidos");
      } else {
        window.location.href = callbackUrl;
        router.refresh();
      }
    } catch (err) {
      setError("Ocorreu um erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen relative overflow-hidden bg-background">

      <div className="relative z-10 w-full max-w-md p-4 animate-in fade-in zoom-in-95 duration-500">
        <div className="flex flex-col items-center mb-8">
          <BrandLogo crm className="h-14 mb-6" />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Bem-vindo de volta</h1>
          <p className="text-muted-foreground mt-2">Acesse sua conta Saiaê</p>
        </div>

        <div className="bg-card rounded-[24px] p-8">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center font-medium animate-in shake duration-300">
              {error}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
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
                    <div className="pt-1 text-right">
                      <Link href="/auth/forgot-password" className="text-sm font-semibold underline underline-offset-4 hover:text-foreground/70">
                        Esqueci minha senha
                      </Link>
                    </div>
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                size="lg"
                className="w-full h-12 text-base mt-2"
                disabled={loading}
              >
                {loading ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" />  Autenticando...</>
                ) : (
                  <>Entrar <ArrowRight className="ml-2 h-5 w-5" /></>
                )}
              </Button>
            </form>
          </Form>
        </div>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          
          Não tem uma conta?{" "}
          <Link href="/auth/register" className="font-semibold text-foreground underline underline-offset-4 hover:text-foreground/70 transition-colors">
            
            Criar uma conta
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
