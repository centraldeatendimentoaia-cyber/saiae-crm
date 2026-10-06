"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { AlertCircle, ShieldAlert } from "lucide-react";

interface RegistrationWarningProps {
    role?: string;
    registrationEnabled?: boolean;
}

export function RegistrationWarning({ role, registrationEnabled }: RegistrationWarningProps) {
    useEffect(() => {
        if (role === "SUPERADMIN" && registrationEnabled) {
            // Delay toast slightly to wait for `<Toaster>` provider mount in layout
            const timer = setTimeout(() => {
                toast("O cadastro público está ativado", {
                    description: "Qualquer pessoa pode se cadastrar nesta instância. Se não for intencional, desative nas Configurações do Sistema para evitar acessos indevidos.",
                    icon: <ShieldAlert className="text-amber-500 w-5 h-5" />,
                    duration: 8000,
                    position: "top-center",
                    action: {
                        label: "Configurações",
                        onClick: () => window.location.href = "/dashboard/settings"
                    }
                });
            }, 1000);

            return () => clearTimeout(timer);
        }
    }, [role, registrationEnabled]);

    return null;
}
