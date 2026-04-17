export * from './shared.js';
export * from './core.js';
export * from './search.js';
export * from './knowledge.js';
export * from './graph.js';
export * from './agent.js';
export * from './narrative.js';
export * from './session.js';

import type { ToolDefinition } from './shared.js';
import { coreToolDefinitions } from './core.js';
import { searchToolDefinitions } from './search.js';
import { knowledgeToolDefinitions } from './knowledge.js';
import { graphToolDefinitions } from './graph.js';
import { agentToolDefinitions } from './agent.js';
import { narrativeToolDefinitions } from './narrative.js';
import { sessionToolDefinitions } from './session.js';

// Re-assemble in the exact original order from tools.ts to preserve any ordering assumptions.
// Original order (by first appearance of the tool name):
//  observe, summarize, search, timeline, get, stats, configure, execute,
//  index_content, search_content, save_knowledge, search_knowledge,
//  promote_knowledge, global_search, update_profile, budget_status, budget_configure,
//  restore_session, emit_event, query_events, graph_query, add_relationship,
//  graph_neighbors, agent_register, agent_status, claim_files, agent_broadcast,
//  time_travel, ask, resolve_contradiction, handoff_session, recall, generate_story,
//  predict_loss, explain_decision, import_conversations, browse, list_topics,
//  find_tunnels, wake_up, temporal_query, entity_detect, list_people,
//  merge_suggestions, diagnostics

const coreDefs = coreToolDefinitions; // observe, summarize, timeline, get, stats, configure, execute
const searchDefs = searchToolDefinitions; // search, index_content, search_content, search_knowledge, recall, ask, browse
const knowledgeDefs = knowledgeToolDefinitions; // save_knowledge, promote_knowledge, global_search, merge_suggestions, resolve_contradiction, temporal_query
const graphDefs = graphToolDefinitions; // graph_query, add_relationship, graph_neighbors, entity_detect, list_people
const agentDefs = agentToolDefinitions; // agent_register, agent_status, claim_files, agent_broadcast
const narrativeDefs = narrativeToolDefinitions; // generate_story, explain_decision, predict_loss, wake_up
const sessionDefs = sessionToolDefinitions; // update_profile, budget_status, budget_configure, restore_session, emit_event, query_events, time_travel, import_conversations, list_topics, find_tunnels, diagnostics, handoff_session

// Extract specific defs by name for precise ordering
function byName(defs: ToolDefinition[], ...names: string[]): ToolDefinition[] {
  return names.map(n => defs.find(d => d.name === n)).filter((d): d is ToolDefinition => d !== undefined);
}

export const toolDefinitions: ToolDefinition[] = [
  // Task 19 tools
  ...byName(coreDefs, 'observe', 'summarize'),
  // Task 20 tools
  ...byName(searchDefs, 'search'),
  ...byName(coreDefs, 'timeline', 'get'),
  // Task 21 tools
  ...byName(coreDefs, 'stats', 'configure', 'execute'),
  // Content store tools
  ...byName(searchDefs, 'index_content', 'search_content'),
  // Knowledge base tools
  ...byName(knowledgeDefs, 'save_knowledge'),
  ...byName(searchDefs, 'search_knowledge'),
  // Global knowledge tools
  ...byName(knowledgeDefs, 'promote_knowledge', 'global_search'),
  // Profile tools
  ...byName(sessionDefs, 'update_profile'),
  // Budget tools
  ...byName(sessionDefs, 'budget_status', 'budget_configure'),
  // Session tools
  ...byName(sessionDefs, 'restore_session'),
  // Event tools
  ...byName(sessionDefs, 'emit_event', 'query_events'),
  // Knowledge Graph tools
  ...byName(graphDefs, 'graph_query', 'add_relationship', 'graph_neighbors'),
  // Multi-Agent coordination tools
  ...byName(agentDefs, 'agent_register', 'agent_status', 'claim_files', 'agent_broadcast'),
  // Time-Travel Debugging
  ...byName(sessionDefs, 'time_travel'),
  // Natural Language Query tool
  ...byName(searchDefs, 'ask'),
  // Contradiction Resolution
  ...byName(knowledgeDefs, 'resolve_contradiction'),
  // Session Handoff
  ...byName(sessionDefs, 'handoff_session'),
  // Total Recall — Verbatim Recall
  ...byName(searchDefs, 'recall'),
  // Total Recall — Generate Story
  ...byName(narrativeDefs, 'generate_story'),
  // Total Recall — Predict Loss
  ...byName(narrativeDefs, 'predict_loss'),
  // Total Recall — Decision Trail
  ...byName(narrativeDefs, 'explain_decision'),
  // Total Recall — Conversation Import
  ...byName(sessionDefs, 'import_conversations'),
  // Total Recall — Browse & Topics
  ...byName(searchDefs, 'browse'),
  ...byName(sessionDefs, 'list_topics', 'find_tunnels'),
  // Total Recall — Wake-Up Primer
  ...byName(narrativeDefs, 'wake_up'),
  // Total Recall — Temporal Query
  ...byName(knowledgeDefs, 'temporal_query'),
  // Total Recall — Entity Detection
  ...byName(graphDefs, 'entity_detect', 'list_people'),
  // Merge suggestions
  ...byName(knowledgeDefs, 'merge_suggestions'),
  // Diagnostics
  ...byName(sessionDefs, 'diagnostics'),
];
