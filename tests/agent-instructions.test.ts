import { access, readFile } from 'node:fs/promises';
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

    it('does not keep a duplicate Claude-specific project skill', async () => {
        await expect(access(resolve(projectRoot, '.claude/skills/obsidian-image-manager')))
            .rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('indexes the canonical design documentation from the project skill', async () => {
        const skill = await readProjectFile(canonicalSkillPath);
        const designIndex = await readProjectFile('docs/design/README.md');
        const issue17Design = await readProjectFile('docs/design/issue-17-remote-image-management.md');

        expect(skill).toContain('../../../docs/design/README.md');
        expect(skill).toContain('../../../docs/design/issue-17-remote-image-management.md');
        expect(designIndex).toContain('Issue #17 图床远程对象管理');
        expect(issue17Design).toContain('**状态：已完成。**');
    });

    it('declares the ES2017 library required by production source APIs', async () => {
        const tsconfig = JSON.parse(await readProjectFile('tsconfig.json')) as {
            compilerOptions?: { lib?: string[] };
        };

        expect(tsconfig.compilerOptions?.lib).toContain('ES2017');
    });
});
