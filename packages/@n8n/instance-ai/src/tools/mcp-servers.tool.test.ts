import { mock } from 'vitest-mock-extended';

import { executeTool } from '../__tests__/tool-test-utils';
import type { InstanceAiContext, InstanceAiMcpService, McpRegistryServerSummary } from '../types';
import { createMcpServersTool } from './mcp-servers.tool';

const notion: McpRegistryServerSummary = {
	slug: 'notion',
	title: 'Notion',
	description: 'Work with Notion pages and databases',
	tools: [{ name: 'create_page', title: 'Create page' }],
	isConnected: false,
};

const linear: McpRegistryServerSummary = {
	slug: 'linear',
	title: 'Linear',
	description: 'Track issues in Linear',
	tools: [{ name: 'create_issue' }],
	isConnected: true,
};

function makeContext(mcpService?: InstanceAiMcpService): InstanceAiContext {
	const context = mock<InstanceAiContext>();
	context.mcpService = mcpService;
	return context;
}

function makeService(
	servers: McpRegistryServerSummary[],
	overrides: Partial<InstanceAiMcpService> = {},
): InstanceAiMcpService {
	return {
		search: vi.fn().mockResolvedValue(servers),
		getServers: vi
			.fn()
			.mockImplementation((slugs: string[]) =>
				servers.filter((server) => slugs.includes(server.slug)),
			),
		listConnectedSlugs: vi
			.fn()
			.mockResolvedValue(
				new Set(servers.filter((server) => server.isConnected).map((server) => server.slug)),
			),
		...overrides,
	};
}

interface SearchOutput {
	results: McpRegistryServerSummary[];
	hint?: string;
}

interface ConnectOutput {
	connectedSlugs: string[];
	skipped?: boolean;
	unknownSlugs?: string[];
	message: string;
}

interface SuspendPayload {
	requestId: string;
	message: string;
	mcpConnectRequest: { servers: Array<{ serverSlug: string; title: string; tagline?: string }> };
}

function suspendingContext() {
	const suspend = vi.fn().mockResolvedValue(undefined);
	return { ctx: { resumeData: undefined, suspend }, suspend };
}

describe('mcp-servers tool', () => {
	describe('search', () => {
		it('passes the queries through and returns the host-annotated results', async () => {
			const mcpService = makeService([notion, linear]);
			const tool = createMcpServersTool(makeContext(mcpService));

			const output = await executeTool<SearchOutput>(tool, {
				action: 'search',
				queries: ['notion', 'linear'],
			});

			expect(mcpService.search).toHaveBeenCalledWith(['notion', 'linear']);
			expect(output.results).toEqual([notion, linear]);
		});

		it('returns no results when nothing matches', async () => {
			const tool = createMcpServersTool(makeContext(makeService([])));

			const output = await executeTool<SearchOutput>(tool, {
				action: 'search',
				queries: ['nothing-like-this'],
			});

			expect(output.results).toEqual([]);
		});

		it('points at the connect action while any result is unconnected', async () => {
			const tool = createMcpServersTool(makeContext(makeService([notion, linear])));

			const output = await executeTool<SearchOutput>(tool, {
				action: 'search',
				queries: ['notion'],
			});

			expect(output.hint).toContain('action: "connect"');
		});

		it('omits the hint when everything found is already connected', async () => {
			const tool = createMcpServersTool(makeContext(makeService([linear])));

			const output = await executeTool<SearchOutput>(tool, {
				action: 'search',
				queries: ['linear'],
			});

			expect(output.hint).toBeUndefined();
		});

		it('rejects an empty query list', async () => {
			const tool = createMcpServersTool(makeContext(makeService([notion])));

			await expect(executeTool(tool, { action: 'search', queries: [] })).rejects.toThrow();
		});

		it('fails loudly when the host did not wire the MCP service', async () => {
			const tool = createMcpServersTool(makeContext(undefined));

			await expect(executeTool(tool, { action: 'search', queries: ['notion'] })).rejects.toThrow(
				'The MCP registry is not available on this instance.',
			);
		});

		it('propagates registry failures', async () => {
			const mcpService = makeService([], {
				search: vi.fn().mockRejectedValue(new Error('registry unavailable')),
			});
			const tool = createMcpServersTool(makeContext(mcpService));

			await expect(executeTool(tool, { action: 'search', queries: ['notion'] })).rejects.toThrow(
				'registry unavailable',
			);
		});
	});

	describe('connect', () => {
		it('suspends with the unconnected servers and the reason', async () => {
			const tool = createMcpServersTool(makeContext(makeService([notion])));
			const { ctx, suspend } = suspendingContext();

			await executeTool(
				tool,
				{ action: 'connect', serverSlugs: ['notion'], reason: 'To read your Notion pages' },
				ctx,
			);

			const payload = suspend.mock.calls[0][0] as SuspendPayload;
			expect(payload.message).toBe('To read your Notion pages');
			expect(payload.requestId).toBeTruthy();
			expect(payload.mcpConnectRequest).toEqual({
				servers: [
					{
						serverSlug: 'notion',
						title: 'Notion',
						tagline: 'Work with Notion pages and databases',
					},
				],
			});
		});

		it('only offers the servers that are not connected yet', async () => {
			const tool = createMcpServersTool(makeContext(makeService([notion, linear])));
			const { ctx, suspend } = suspendingContext();

			await executeTool(
				tool,
				{ action: 'connect', serverSlugs: ['notion', 'linear'], reason: 'Because' },
				ctx,
			);

			const payload = suspend.mock.calls[0][0] as SuspendPayload;
			expect(payload.mcpConnectRequest.servers.map((s) => s.serverSlug)).toEqual(['notion']);
		});

		it('is a no-op when every requested server is already connected', async () => {
			const tool = createMcpServersTool(makeContext(makeService([linear])));
			const { ctx, suspend } = suspendingContext();

			const output = await executeTool<ConnectOutput>(
				tool,
				{ action: 'connect', serverSlugs: ['linear'], reason: 'Because' },
				ctx,
			);

			expect(suspend).not.toHaveBeenCalled();
			expect(output.connectedSlugs).toEqual(['linear']);
			expect(output.message).toContain('Already connected');
		});

		it('tells the agent to search first when no slug resolves', async () => {
			const tool = createMcpServersTool(makeContext(makeService([notion])));
			const { ctx, suspend } = suspendingContext();

			const output = await executeTool<ConnectOutput>(
				tool,
				{ action: 'connect', serverSlugs: ['made-up'], reason: 'Because' },
				ctx,
			);

			expect(suspend).not.toHaveBeenCalled();
			expect(output.unknownSlugs).toEqual(['made-up']);
			expect(output.message).toContain('action: "search"');
		});

		it('rejects more than three suggestions', async () => {
			const tool = createMcpServersTool(makeContext(makeService([notion])));

			await expect(
				executeTool(
					tool,
					{ action: 'connect', serverSlugs: ['a', 'b', 'c', 'd'], reason: 'Because' },
					suspendingContext().ctx,
				),
			).rejects.toThrow();
		});

		it('names an invented slug alongside the servers it did resolve', async () => {
			const tool = createMcpServersTool(makeContext(makeService([notion])));
			const { ctx, suspend } = suspendingContext();

			await executeTool(
				tool,
				{ action: 'connect', serverSlugs: ['notion', 'made-up'], reason: 'Because' },
				ctx,
			);

			const payload = suspend.mock.calls[0][0] as SuspendPayload;
			expect(payload.mcpConnectRequest.servers.map((s) => s.serverSlug)).toEqual(['notion']);
			expect(payload.message).toContain('made-up');
		});

		it('reports only the slugs the server confirms are connected', async () => {
			const mcpService = makeService([notion], {
				listConnectedSlugs: vi.fn().mockResolvedValue(new Set(['notion'])),
			});
			const tool = createMcpServersTool(makeContext(mcpService));

			const output = await executeTool<ConnectOutput>(
				tool,
				{ action: 'connect', serverSlugs: ['notion'], reason: 'Because' },
				{ resumeData: { approved: true, connectedSlugs: ['notion'] } },
			);

			expect(output.connectedSlugs).toEqual(['notion']);
			expect(output.message).toContain('search_tools');
		});

		it('ignores a client claim the server cannot confirm', async () => {
			const mcpService = makeService([notion], {
				listConnectedSlugs: vi.fn().mockResolvedValue(new Set<string>()),
			});
			const tool = createMcpServersTool(makeContext(mcpService));

			const output = await executeTool<ConnectOutput>(
				tool,
				{ action: 'connect', serverSlugs: ['notion'], reason: 'Because' },
				{ resumeData: { approved: true, connectedSlugs: ['notion'] } },
			);

			expect(output.connectedSlugs).toEqual([]);
			expect(output.message).toContain('No connection was created');
		});

		it('reports a skip when the user dismissed the card', async () => {
			const mcpService = makeService([notion], {
				listConnectedSlugs: vi.fn().mockResolvedValue(new Set<string>()),
			});
			const tool = createMcpServersTool(makeContext(mcpService));

			const output = await executeTool<ConnectOutput>(
				tool,
				{ action: 'connect', serverSlugs: ['notion'], reason: 'Because' },
				{ resumeData: { approved: false } },
			);

			expect(output).toMatchObject({ connectedSlugs: [], skipped: true });
			expect(output.message).toContain('skipped');
		});

		it('still reports a connection made before the user skipped the rest', async () => {
			const mcpService = makeService([notion], {
				listConnectedSlugs: vi.fn().mockResolvedValue(new Set(['notion'])),
			});
			const tool = createMcpServersTool(makeContext(mcpService));

			const output = await executeTool<ConnectOutput>(
				tool,
				{ action: 'connect', serverSlugs: ['notion'], reason: 'Because' },
				{ resumeData: { approved: false, connectedSlugs: ['notion'] } },
			);

			expect(output.connectedSlugs).toEqual(['notion']);
		});

		it('does not credit the card for a server connected before it appeared', async () => {
			const mcpService = makeService([notion, linear], {
				listConnectedSlugs: vi.fn().mockResolvedValue(new Set(['linear'])),
			});
			const tool = createMcpServersTool(makeContext(mcpService));

			const output = await executeTool<ConnectOutput>(
				tool,
				{ action: 'connect', serverSlugs: ['notion', 'linear'], reason: 'Because' },
				{ resumeData: { approved: false, connectedSlugs: [] } },
			);

			expect(output).toMatchObject({ connectedSlugs: [], skipped: true });
		});
	});
});
