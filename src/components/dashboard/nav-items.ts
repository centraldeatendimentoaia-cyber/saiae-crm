import {
    LayoutDashboard,
    MessageSquare,
    MessagesSquare,
    Users,
    UserX,
    Settings,
    QrCode,
    ImageIcon,
    Webhook,
    CalendarClock,
    Share2,
    Bot,
    Sparkles,
    Bell,
    Code,
    UserCheck,
    Megaphone,
    HardDrive,
    Activity,
    UserCircle,
    Tag,
    MessageCircleReply,
    UserPlus,
    BookOpen,
    CreditCard,
    BarChart3,
    GraduationCap,
} from "lucide-react";

export interface NavItem {
    href: string;
    label: string;
    icon: React.ElementType;
    external?: boolean;
    superadminOnly?: boolean;
}

export interface NavGroup {
    label: string;
    items: NavItem[];
}

// Fonte única do menu: usada pela sidebar (desktop) e pelo menu mobile.
export const navGroups: NavGroup[] = [
    {
        label: "Principal",
        items: [
            { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
            { href: "/dashboard/sessions", label: "Sessões / QR", icon: QrCode },
            { href: "/dashboard/guia", label: "Guia de uso", icon: BookOpen },
            { href: "/dashboard/assinatura", label: "Plano e assinatura", icon: CreditCard },
            { href: "/dashboard/notificacoes", label: "Notificações", icon: Bell },
        ],
    },
    {
        label: "Mensagens",
        items: [
            { href: "/dashboard/chat", label: "Conversas", icon: MessageSquare },
            { href: "/dashboard/broadcast", label: "Disparo", icon: Megaphone },
            { href: "/dashboard/metricas", label: "Métricas de atendimento", icon: BarChart3 },
            { href: "/dashboard/descadastros", label: "Descadastrados", icon: UserX },
            { href: "/dashboard/sticker", label: "Criador de figurinhas", icon: ImageIcon },
        ],
    },
    {
        label: "Contatos",
        items: [
            { href: "/dashboard/contacts", label: "Contatos", icon: UserCheck },
            { href: "/dashboard/groups", label: "Grupos", icon: Users },
            { href: "/dashboard/labels", label: "Etiquetas", icon: Tag },
        ],
    },
    {
        label: "Automação",
        items: [
            { href: "/dashboard/bot-settings", label: "Configurações do Bot", icon: Bot },
            { href: "/dashboard/autoreply", label: "Resposta automática", icon: MessageCircleReply },
            { href: "/dashboard/atendente-ia", label: "Conversas da IA", icon: MessagesSquare, superadminOnly: true },
            { href: "/dashboard/agente-ia", label: "Agente de atendimento", icon: Sparkles, superadminOnly: true },
            { href: "/dashboard/atendente-treino", label: "Treinar atendente", icon: GraduationCap, superadminOnly: true },
            { href: "/dashboard/profile", label: "Perfil do bot", icon: UserCircle },
            { href: "/dashboard/scheduler", label: "Agendador", icon: CalendarClock },
        ],
    },
    {
        label: "Redes Sociais",
        items: [
            { href: "/dashboard/redes-sociais", label: "Redes Sociais", icon: Share2 },
        ],
    },
    {
        label: "Desenvolvedor",
        items: [
            { href: "/dashboard/webhooks", label: "Webhooks e API", icon: Webhook },
            { href: "/swagger", label: "Documentação da API", icon: Code, external: true },
        ],
    },
    {
        label: "Administração",
        items: [
            { href: "/dashboard/media", label: "Gerenciador de mídia", icon: HardDrive },
            { href: "/dashboard/sessions/access", label: "Acesso às sessões", icon: UserPlus },
            { href: "/dashboard/users", label: "Usuários", icon: Users, superadminOnly: true },
            { href: "/dashboard/settings", label: "Configurações", icon: Settings },
            { href: "/dashboard/system-monitor", label: "Monitor do sistema", icon: Activity, superadminOnly: true },
        ],
    },
];
