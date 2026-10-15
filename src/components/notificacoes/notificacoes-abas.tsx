"use client";

import { Bell } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificacoesRecebidas } from "./recebidas";
import { EnviarNotificacao } from "./enviar";

export function NotificacoesAbas({ podeEnviar, abaInicial }: { podeEnviar: boolean; abaInicial: "recebidas" | "enviar" }) {
    return (
        <div className="space-y-6">
            <h1 className="text-xl sm:text-3xl font-bold flex items-center gap-2">
                <Bell className="h-6 w-6 sm:h-8 sm:w-8" /> Notificações
            </h1>

            <Tabs defaultValue={podeEnviar ? abaInicial : "recebidas"}>
                {podeEnviar && (
                    <TabsList>
                        <TabsTrigger value="recebidas">Recebidas</TabsTrigger>
                        <TabsTrigger value="enviar">Enviar</TabsTrigger>
                    </TabsList>
                )}
                <TabsContent value="recebidas">
                    <NotificacoesRecebidas />
                </TabsContent>
                {podeEnviar && (
                    <TabsContent value="enviar">
                        <EnviarNotificacao />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
