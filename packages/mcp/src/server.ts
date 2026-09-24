/**
 * Stdio MCP server — seven tools, no resources.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createMcpTools } from './tools';

const jsonResult = (value: unknown): { content: { type: 'text'; text: string }[] } => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

const seatSchema = { seat: z.string() };

export const createConquarrowServer = (): McpServer => {
  const tools = createMcpTools();
  const server = new McpServer(
    { name: 'conquarrow', version: '0.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.registerTool(
    'new_match',
    {
      description: 'Start a 3- or 6-seat match over rules-core',
      inputSchema: {
        playerCount: z.number(),
        seats: z.array(z.string()),
        R: z.number().optional(),
        homeOffset: z.number().optional(),
        dominationN: z.number().optional(),
        spawnerSeed: z.number().optional(),
      },
    },
    (args) =>
      jsonResult(
        tools.new_match({
          playerCount: args.playerCount,
          seats: args.seats,
          ...(args.R !== undefined ? { R: args.R } : {}),
          ...(args.homeOffset !== undefined ? { homeOffset: args.homeOffset } : {}),
          ...(args.dominationN !== undefined ? { dominationN: args.dominationN } : {}),
          ...(args.spawnerSeed !== undefined ? { spawnerSeed: args.spawnerSeed } : {}),
        }),
      ),
  );

  server.registerTool(
    'observe',
    { description: 'Seat-scoped observation, not raw GameState', inputSchema: seatSchema },
    (args) => jsonResult(tools.observe({ seat: args.seat })),
  );

  server.registerTool(
    'legal_moves',
    {
      description: 'Numbered BYOK-shaped legal step rows',
      inputSchema: { seat: z.string(), includeMills: z.boolean().optional() },
    },
    (args) =>
      jsonResult(
        tools.legal_moves({
          seat: args.seat,
          ...(args.includeMills === false ? { includeMills: false } : {}),
        }),
      ),
  );

  server.registerTool(
    'apply_steps',
    {
      description: 'Apply legal steps for the active human seat',
      inputSchema: {
        seat: z.string(),
        steps: z.array(z.object({ from: z.string(), exit: z.string(), count: z.number() })).optional(),
        indices: z.array(z.number()).optional(),
      },
    },
    (args) =>
      jsonResult(
        tools.apply_steps({
          seat: args.seat,
          ...(args.steps !== undefined ? { steps: args.steps } : {}),
          ...(args.indices !== undefined ? { indices: args.indices } : {}),
        }),
      ),
  );

  server.registerTool(
    'end_turn',
    { description: 'End the active human turn', inputSchema: seatSchema },
    (args) => jsonResult(tools.end_turn({ seat: args.seat })),
  );

  server.registerTool(
    'play_heuristic_turn',
    { description: 'Play frozen greedy-v1 for the active heuristic seat', inputSchema: seatSchema },
    (args) => jsonResult(tools.play_heuristic_turn({ seat: args.seat })),
  );

  server.registerTool(
    'see_board',
    { description: 'Simple SVG of the match R-window', inputSchema: seatSchema },
    (args) => jsonResult(tools.see_board({ seat: args.seat })),
  );

  // Advertise an empty resource list so resources/list is implemented, not absent.
  server.server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }));
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates: [],
  }));

  return server;
};

export const startConquarrowStdio = async (): Promise<void> => {
  const server = createConquarrowServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
