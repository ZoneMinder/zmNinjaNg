/**
 * Runs the force-directed "around this event" graph (event-graph.ts) as a
 * React hook (refs #494): builds the layout whenever the rows, window or
 * container size change, drives it forward on requestAnimationFrame until it
 * settles (event-graph's own settle energy), and stops scheduling frames once
 * settled - an idle graph costs no frames.
 *
 * Dragging holds a node at the caller's chosen position; releasing it lets
 * the simulation pull it back. Under prefers-reduced-motion the layout
 * settles synchronously (capped iteration count) instead of animating, and
 * a drag there moves the node directly with no running loop to pull it back
 * until release, which re-settles synchronously too.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildGraph, stepGraph, type GraphNode, type GraphEdge } from '../lib/event/event-graph';
import { EVENT_CONTEXT } from '../lib/zmninja-ng-constants';
import type { EventAroundRow } from './useEventsAround';

/** Ceiling on the synchronous reduced-motion settle. event-graph.test.ts
 *  proves a typical window settles well under this. */
const MAX_SYNC_STEPS = 500;

export interface UseGraphSimulationOptions {
  rows: EventAroundRow[];
  windowMs: number;
  /** Not read by the physics; a resize is a restart trigger only. */
  containerWidth: number;
  reducedMotion: boolean;
}

export interface UseGraphSimulationResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  beginDrag: (eventId: string) => void;
  dragTo: (x: number, y: number) => void;
  endDrag: () => void;
}

function settleSync(nodes: GraphNode[], edges: GraphEdge[]): void {
  let energy = Number.POSITIVE_INFINITY;
  let steps = 0;
  while (energy >= EVENT_CONTEXT.graphSettleEnergy && steps < MAX_SYNC_STEPS) {
    energy = stepGraph(nodes, edges, {});
    steps++;
  }
}

export function useGraphSimulation({
  rows,
  windowMs,
  containerWidth,
  reducedMotion,
}: UseGraphSimulationOptions): UseGraphSimulationResult {
  // graphRef is the mutation target every frame; `graph` state mirrors it so
  // render reads state (never a ref during render, react-hooks/refs). Each
  // repaint() hands state a fresh wrapper object over the SAME node/edge
  // arrays, so React always sees a change worth rendering while the nodes
  // keep the identity stepGraph mutates in place.
  const graphRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const draggingRef = useRef<string | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const repaint = useCallback(() => {
    setGraph({ nodes: graphRef.current.nodes, edges: graphRef.current.edges });
  }, []);

  const runLoop = useCallback(() => {
    if (rafRef.current !== undefined) return;
    const step = () => {
      const energy = stepGraph(graphRef.current.nodes, graphRef.current.edges, { draggingId: draggingRef.current });
      repaint();
      if (energy >= EVENT_CONTEXT.graphSettleEnergy || draggingRef.current !== undefined) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = undefined;
      }
    };
    rafRef.current = requestAnimationFrame(step);
  }, [repaint]);

  useEffect(() => {
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    draggingRef.current = undefined;
    graphRef.current = buildGraph(rows, windowMs);

    if (reducedMotion) {
      settleSync(graphRef.current.nodes, graphRef.current.edges);
    } else {
      runLoop();
    }
    repaint();

    return () => {
      if (rafRef.current !== undefined) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      }
    };
  }, [rows, windowMs, containerWidth, reducedMotion, runLoop, repaint]);

  const beginDrag = useCallback(
    (eventId: string) => {
      draggingRef.current = eventId;
      if (!reducedMotion) runLoop();
    },
    [reducedMotion, runLoop]
  );

  const dragTo = useCallback(
    (x: number, y: number) => {
      const id = draggingRef.current;
      if (!id) return;
      const node = graphRef.current.nodes.find((n) => n.eventId === id);
      if (!node) return;
      node.x = x;
      node.y = y;
      if (reducedMotion) repaint();
    },
    [reducedMotion, repaint]
  );

  const endDrag = useCallback(() => {
    draggingRef.current = undefined;
    if (reducedMotion) {
      settleSync(graphRef.current.nodes, graphRef.current.edges);
      repaint();
    } else {
      runLoop();
    }
  }, [reducedMotion, runLoop, repaint]);

  return { nodes: graph.nodes, edges: graph.edges, beginDrag, dragTo, endDrag };
}
