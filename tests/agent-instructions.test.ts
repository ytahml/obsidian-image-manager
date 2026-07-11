import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(import.meta.dirname, '..');
const canonicalSkillPath = '.agents/skills/obsidian-image-manager/SKILL.md';

async function readProjectFile(path: string): Promise<string> {
    return readFile(resolve(projectRoot, path), 'utf8');
}

describe('agent instruction entrypoints', () => {
    it('keeps the canonical project skill available', async () => {
        const skill = await readProjectFile(canonicalSkillPath);

        expect(skill).toContain('name: obsidian-image-manager');
        expect(skill).toContain('## Reference Index');
    });

    it.each(['AGENTS.md', 'CLAUDE.md'])('%s points to the canonical project skill', async (entrypoint) => {
        const content = await readProjectFile(entrypoint);

        expect(content).toContain(canonicalSkillPath);
        expect(content).toContain('npm test');
        expect(content).toContain('npm run build');
    });

    it('keeps CLAUDE.md as a small compatibility entrypoint', async () => {
        const claudeInstructions = await readProjectFile('CLAUDE.md');

        expect(claudeInstructions).toContain(`@${canonicalSkillPath}`);
        expect(claudeInstructions.split('\n').length).toBeLessThan(30);
        expect(claudeInstructions).not.toContain('.claude/skills/');
    });
});
