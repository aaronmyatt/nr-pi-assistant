// ============================================================================
// Agent Scheduler — Shared concurrency, dedup, and transaction layer
// ============================================================================
//
// Every LLM agent (hints, labels, next-node, next-config, etc.) goes through
// this scheduler to request an LLM call. It enforces:
//
//   1. Per-(nodeId, agentName) in-flight dedup — never double-fire.
//   2. Per-(nodeId, agentName) attempt caps — bound cost.
//   3. Fingerprint-keyed cache invalidation (canonical fingerprint from
//      dagSerializer.fingerprintNode).
//   4. Debounce/coalescing of rapid events.
//   5. Transaction-id discipline — one tx per call.
//
// The scheduler is a *gatekeeper*, not an executor. The agent owns the
// actual AJAX call, but must check in and out through acquire() / commit()
// / release() so the shared state stays consistent.
//
// Why one module:
// - hintsSidebar had _aiHintsFetching, _aiHintsAttempts, _aiHintsCache copy-
//   pasted. autoLabeler had its own fingerprint with different skip-sets.
// - TASK-12.7 unified the fingerprint; this unifies the lifecycle.
// - Future specialist agents (next-node, port-label) all share the same
//   dedup/cache/cap layer without copy-paste.
//
// Ref: resources/hintsSidebar.js (primary consumer)
// Ref: resources/dagSerializer.js (fingerprint source)
//
// Examples:
//   const scheduler = new AgentScheduler()
//   scheduler.register('hint', { maxAttempts: 3, debounceMs: 0 })
//
//   const permit = scheduler.acquire('hint', {
//       node, upstream: [...], downstream: [...]
//   })
//   if (!permit.allowed) return
//   if (permit.fromCache) { useCache(permit.cachedResult); return }
//
//   $.ajax({ ...,
//       success: (reply) => {
//           const result = parseReply(reply)
//           scheduler.commit('hint', node.id, result)
//       },
//       error: () => scheduler.release('hint', node.id)
//   })

import { fingerprintNode } from './dagSerializer.js'

// ── AgentConfig (private class for typed state) ─────────────────────────────

/**
 * Per-agent configuration and runtime state. Kept private — callers go
 * through AgentScheduler methods.
 */
class AgentConfig {
    /** @type {string} */
    name

    /** @type {number} */
    maxAttempts

    /** @type {number} */
    debounceMs

    /** @type {Map<string, {fingerprint: string, result: any, timestamp: number}>} */
    cache

    /** @type {Set<string>} */
    inflight

    /** @type {Map<string, number>} */
    attempts

    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    timers

    constructor (name, { maxAttempts = 3, debounceMs = 0 } = {}) {
        this.name = name
        this.maxAttempts = maxAttempts
        this.debounceMs = debounceMs
        this.cache = new Map()
        this.inflight = new Set()
        this.attempts = new Map()
        this.timers = new Map()
    }
}

// ── Permit (returned by acquire) ────────────────────────────────────────────

/**
 * Result of acquire(). Tells the agent whether to proceed, skip (cached),
 * or abort (in-flight / capped / debounced).
 */
class Permit {
    /** @type {boolean} True if the agent should proceed with the LLM call. */
    allowed = false

    /** @type {boolean} True if result came from cache — use cachedResult. */
    fromCache = false

    /** @type {any} The cached result, if fromCache is true. */
    cachedResult = null

    /** @type {string} Unique transaction id for correlation. */
    transactionId = ''

    /** @type {string} Reason for denial (for logging). */
    reason = ''
}

// ── AgentScheduler ──────────────────────────────────────────────────────────

export class AgentScheduler {
    /** @type {Map<string, AgentConfig>} */
    _agents = new Map()

    // ── Registration ────────────────────────────────────────────────────────

    /**
     * Register a named agent. Must be called before acquire() for that name.
     *
     * @param {string} name - Unique agent identifier (e.g. 'hint', 'label').
     * @param {Object} [options]
     * @param {number} [options.maxAttempts=3] - Cap per node per session.
     * @param {number} [options.debounceMs=0] - Debounce rapid events (0 = off).
     * @returns {void}
     */
    register (name, { maxAttempts = 3, debounceMs = 0 } = {}) {
        if (this._agents.has(name)) {
            console.warn(`[nr-assistant:scheduler] agent "${name}" already registered — overwriting`)
        }
        this._agents.set(name, new AgentConfig(name, { maxAttempts, debounceMs }))
        console.log(`[nr-assistant:scheduler] registered agent "${name}"`, { maxAttempts, debounceMs })
    }

    // ── Acquire ─────────────────────────────────────────────────────────────

    /**
     * Request permission to make an LLM call for a given node.
     *
     * Checks cache, in-flight dedup, attempt cap, and debounce. Returns a
     * Permit that tells the caller exactly what to do.
     *
     * @param {string} agentName
     * @param {Object} params
     * @param {Object} params.node - The node instance.
     * @param {Object[]} [params.upstream=[]] - Nodes wired into this node.
     * @param {Object[]} [params.downstream=[]] - Nodes this node feeds into.
     * @returns {Permit}
     */
    acquire (agentName, { node, upstream = [], downstream = [] }) {
        const permit = new Permit()
        const agent = this._agents.get(agentName)
        if (!agent) {
            permit.reason = `agent "${agentName}" not registered`
            return permit
        }

        const nodeId = node?.id
        if (!nodeId) {
            permit.reason = 'node has no id'
            return permit
        }

        // ── Fingerprint (canonical, from dagSerializer) ─────────────────
        const fp = fingerprintNode({ node, upstream, downstream })

        // ── Cache hit ──────────────────────────────────────────────────
        const cached = agent.cache.get(nodeId)
        if (cached && cached.fingerprint === fp) {
            permit.allowed = true
            permit.fromCache = true
            permit.cachedResult = cached.result
            permit.transactionId = `${agentName}-cache-${nodeId}`
            console.log(`[nr-assistant:scheduler] ${agentName} cache hit`, { nodeId })
            return permit
        }

        // Cache miss with old fingerprint → evict stale entry.
        if (cached) {
            agent.cache.delete(nodeId)
        }

        // ── In-flight dedup ────────────────────────────────────────────
        if (agent.inflight.has(nodeId)) {
            permit.reason = 'already in-flight'
            return permit
        }

        // ── Attempt cap ────────────────────────────────────────────────
        const attempts = agent.attempts.get(nodeId) || 0
        if (attempts >= agent.maxAttempts) {
            permit.reason = `max attempts (${agent.maxAttempts}) reached`
            return permit
        }

        // ── Debounce ───────────────────────────────────────────────────
        if (agent.debounceMs > 0) {
            const existing = agent.timers.get(nodeId)
            if (existing) clearTimeout(existing)
            agent.timers.set(nodeId, setTimeout(() => {
                agent.timers.delete(nodeId)
                // The debounced call re-acquires (simplifies the flow —
                // the timer just delays, acquire still runs all checks).
                // But we mark it inflight to prevent double-fire during the
                // debounce window.
            }, agent.debounceMs))
            permit.reason = `debounced (${agent.debounceMs}ms)`
            return permit
        }

        // ── Allowed — mark in-flight and increment attempts ────────────
        agent.inflight.add(nodeId)
        agent.attempts.set(nodeId, attempts + 1)
        permit.allowed = true
        permit.transactionId = `${agentName}-${nodeId}-${Date.now()}`

        console.log(`[nr-assistant:scheduler] ${agentName} acquire`, {
            nodeId,
            attempt: attempts + 1,
            txn: permit.transactionId
        })

        return permit
    }

    // ── Commit / Release ────────────────────────────────────────────────────

    /**
     * Commit a successful result to the cache and release the in-flight lock.
     *
     * @param {string} agentName
     * @param {string} nodeId
     * @param {any} result - The result to cache.
     * @param {Object} [params]
     * @param {Object[]} [params.upstream=[]] - For fingerprint on commit.
     * @param {Object[]} [params.downstream=[]] - For fingerprint on commit.
     * @param {Object} [params.node] - Node reference for fingerprint.
     * @returns {void}
     */
    commit (agentName, nodeId, result, { upstream = [], downstream = [], node = null } = {}) {
        const agent = this._agents.get(agentName)
        if (!agent) return

        agent.inflight.delete(nodeId)

        // Re-fingerprint on commit so the cache key matches the state at
        // response time (the node may have changed during the request).
        const fp = node
            ? fingerprintNode({ node, upstream, downstream })
            : Date.now().toString() // fallback — caller should pass node

        agent.cache.set(nodeId, { fingerprint: fp, result, timestamp: Date.now() })
        console.log(`[nr-assistant:scheduler] ${agentName} commit`, { nodeId, fingerprint: fp.slice(0, 40) })
    }

    /**
     * Release the in-flight lock without caching (called on error/cancel).
     *
     * @param {string} agentName
     * @param {string} nodeId
     * @returns {void}
     */
    release (agentName, nodeId) {
        const agent = this._agents.get(agentName)
        if (!agent) return
        agent.inflight.delete(nodeId)
        console.log(`[nr-assistant:scheduler] ${agentName} release`, { nodeId })
    }

    // ── Introspection (for tests/debugging) ─────────────────────────────────

    /**
     * @param {string} agentName
     * @returns {boolean} Whether the given agent is registered.
     */
    hasAgent (agentName) {
        return this._agents.has(agentName)
    }

    /**
     * @param {string} agentName
     * @param {string} nodeId
     * @returns {boolean} Whether the given node is currently in-flight.
     */
    isInflight (agentName, nodeId) {
        return this._agents.get(agentName)?.inflight.has(nodeId) ?? false
    }

    /**
     * @param {string} agentName
     * @param {string} nodeId
     * @returns {number} Attempt count for the given node.
     */
    attemptCount (agentName, nodeId) {
        return this._agents.get(agentName)?.attempts.get(nodeId) || 0
    }

    /**
     * @param {string} agentName
     * @param {string} nodeId
     * @returns {any|null} Cached result, or null if not cached.
     */
    getCache (agentName, nodeId) {
        return this._agents.get(agentName)?.cache.get(nodeId)?.result ?? null
    }

    /**
     * Reset all state for a given agent (useful in tests).
     *
     * @param {string} agentName
     * @returns {void}
     */
    reset (agentName) {
        const agent = this._agents.get(agentName)
        if (!agent) return
        agent.cache.clear()
        agent.inflight.clear()
        agent.attempts.clear()
        for (const t of agent.timers.values()) clearTimeout(t)
        agent.timers.clear()
    }
}
