import { createContext } from 'react';
import { parser } from '@lezer/markdown';

export type MarkdownTextReferences = Readonly<Record<string, Readonly<{ text: string; url: string }>>>;
export const EMPTY_MARKDOWN_TEXT_REFERENCES: MarkdownTextReferences = Object.freeze({});
export const MarkdownTextReferencesContext = createContext(EMPTY_MARKDOWN_TEXT_REFERENCES);

const protectedNodes = new Set(['CodeBlock', 'FencedCode', 'InlineCode', 'Link', 'Image', 'Autolink', 'LinkReference', 'HTMLBlock', 'HTMLTag']);

/** Render-only projection: source ranges, copying, quoting, and option submission keep authored text. */
export function linkifyMarkdownTextReferences(markdown: string, references: MarkdownTextReferences): string {
    const aliases = Object.keys(references).filter((alias) => alias.length > 0 && markdown.includes(alias));
    if (aliases.length === 0) return markdown;
    const protectedRanges: Array<Readonly<{ from: number; to: number }>> = [];
    parser.parse(markdown).iterate({
        enter(node) {
            if (!protectedNodes.has(node.name)) return;
            protectedRanges.push({ from: node.from, to: node.to });
            return false;
        },
    });
    let rangeIndex = 0;
    const pattern = new RegExp(aliases.sort((a, b) => b.length - a.length).map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    return markdown.replace(pattern, (alias: string, offset: number) => {
        if (/[A-Za-z0-9_/@\\-]/.test(markdown[offset - 1] ?? '') || /[A-Za-z0-9_/@\\-]/.test(markdown[offset + alias.length] ?? '')) return alias;
        while (protectedRanges[rangeIndex] && protectedRanges[rangeIndex]!.to <= offset) rangeIndex += 1;
        const range = protectedRanges[rangeIndex];
        if (range && range.from <= offset && offset < range.to) return alias;
        const reference = references[alias];
        if (!reference) return alias;
        const label = reference.text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]{}()<>!|]/g, '\\$&');
        return `[${label}](${reference.url})`;
    });
}
