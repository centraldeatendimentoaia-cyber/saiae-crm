import fs from 'fs';
import path from 'path';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import { DocsClient } from './docs-client';

export const metadata = {
    title: 'Documentação da API - Saiaê',
    description: 'Referência completa da API da Saiaê (disparador de WhatsApp). Includes endpoints for messaging, groups, contacts, media, and webhooks.',
    openGraph: {
        title: 'Documentação da API - Saiaê',
        description: 'Complete API reference for Saiaê (disparador de WhatsApp).',
        type: 'website',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'API Documentation - Saiaê',
        description: 'Complete API reference for Saiaê (disparador de WhatsApp).',
    },
};

// Interface for Nested TOC
export interface TocItem {
    text: string;
    id: string;
}

export interface TocSection {
    title: string;
    id: string;
    items: TocItem[];
}

export default async function PublicDocsPage() {
    const filePath = path.join(process.cwd(), 'docs', 'API_DOCUMENTATION.md');
    const packagePath = path.join(process.cwd(), 'package.json');
    let content = '';
    let version = 'v1.0.0';

    try {
        content = fs.readFileSync(filePath, 'utf8');
        // Strip extraneous backslash escapes used for markdown brackets
        content = content.replace(/\\(\[)/g, '$1').replace(/\\(])/g, '$1');
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        version = `v${packageJson.version}`;
    } catch (err) {
        content = '# Error\n\nCould not load documentation file.';
        console.error("Error loading docs:", err);
    }

    // Nested TOC Generation
    const toc: TocSection[] = [];
    let currentSection: TocSection | null = null;

    content.split('\n').forEach(line => {
        if (line.startsWith('## ')) {
            // H2 - New Section
            const text = line.replace(/^## /, '').trim();
            const id = text.toLowerCase().replace(/[^\w]+/g, '-');

            // If we have a current section, push it to toc
            if (currentSection) {
                toc.push(currentSection);
            }

            currentSection = {
                title: text,
                id: id,
                items: []
            };
        } else if (line.startsWith('### ') && currentSection) {
            // H3 - Item in current section
            const text = line.replace(/^### /, '').trim();
            const id = text.toLowerCase().replace(/[^\w]+/g, '-');
            currentSection.items.push({ text, id });
        }
    });

    // Push the last section if exists
    if (currentSection) {
        toc.push(currentSection);
    }

    return (
        <div className="min-h-screen bg-zinc-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b sticky top-0 z-30 shadow-sm/50">
                <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-xl font-extrabold bg-gradient-to-r from-zinc-600 to-zinc-600 bg-clip-text text-transparent">
                            Saiaê
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-zinc-100 text-zinc-700 text-xs font-semibold tracking-wide border border-zinc-200">
                            {version}
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <Link
                            href="/swagger"
                            className="text-sm font-medium text-zinc-500 hover:text-zinc-600 transition-colors"
                        >
                            Swagger UI
                        </Link>
                        <Link
                            href="/dashboard"
                            className="text-sm font-medium px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-all shadow-md hover:shadow-lg"
                        >
                            
                            Painel
                        </Link>
                    </div>
                </div>
            </header>

            <DocsClient content={content} toc={toc} />
        </div>
    );
}
