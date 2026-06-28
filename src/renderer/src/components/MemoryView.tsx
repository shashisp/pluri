import { useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import type { MemoryScope, MemoryUpdateMsg, WorkspaceWithRepos } from '@shared/types'
import { Button } from './ui'

interface MemoryEditorProps {
  scope: MemoryScope
  title: string
  subtitle: string
  hint: string
  meta?: string
}

function MemoryEditor({ scope, title, subtitle, hint, meta }: MemoryEditorProps): JSX.Element {
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const savedRef = useRef('') // last loaded/saved content (disk truth)
  const contentRef = useRef('')
  contentRef.current = content
  const dirty = content !== savedRef.current

  const key = `${scope.type}:${scope.id}`

  // Load on scope change.
  useEffect(() => {
    let active = true
    setConflict(false)
    void window.api.readMemory(scope).then((c) => {
      if (!active) return
      savedRef.current = c
      setContent(c)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Live updates from disk (watcher) or other writers.
  useEffect(() => {
    const off = window.api.onMemoryUpdate((m: MemoryUpdateMsg) => {
      if (m.scope.type !== scope.type || m.scope.id !== scope.id) return
      if (m.content === savedRef.current) return // our own write echo
      const isDirty = contentRef.current !== savedRef.current
      if (isDirty) {
        setConflict(true) // changed on disk while editing — don't clobber
      } else {
        savedRef.current = m.content
        setContent(m.content)
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  async function save(): Promise<void> {
    setBusy(true)
    try {
      await window.api.writeMemory(scope, content)
      savedRef.current = content
      setConflict(false)
    } finally {
      setBusy(false)
    }
  }

  async function reloadFromDisk(): Promise<void> {
    const c = await window.api.readMemory(scope)
    savedRef.current = c
    setContent(c)
    setConflict(false)
  }

  return (
    <section className="pluri-card">
      <div className="pluri-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ font: 'var(--font-heading)', color: 'var(--text-strong)' }}>{title}</span>
          <span className="pk-detail__meta">{subtitle}</span>
          {meta && (
            <span className="pk-detail__meta" style={{ marginLeft: 'auto' }}>
              {meta}
            </span>
          )}
        </div>
        <span className="pk-form__hint">{hint}</span>

        {conflict && (
          <div className="pk-warn">
            This file changed on disk while you were editing. Saving will overwrite it.{' '}
            <button
              className="pk-crumb__link"
              style={{ color: 'var(--amber-300)', textDecoration: 'underline' }}
              onClick={reloadFromDisk}
            >
              Reload from disk
            </button>
          </div>
        )}

        <textarea
          className="pluri-textarea pluri-input--mono"
          style={{ minHeight: 200 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          placeholder="# Markdown — saved atomically and injected into agents."
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button variant="primary" icon={<Save size={13} />} onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
          {dirty && <span className="pk-form__hint">unsaved changes</span>}
          <span className="pk-form__hint" style={{ marginLeft: 'auto' }}>
            {content.length} chars
            {content.length > 4000 && (
              <span style={{ color: 'var(--amber-300)' }}> · large — keep memory tight</span>
            )}
          </span>
        </div>
      </div>
    </section>
  )
}

export function MemoryView({ workspace }: { workspace: WorkspaceWithRepos }): JSX.Element {
  return (
    <div className="pk-detail">
      <div className="pk-detail__bar">
        <div className="pk-detail__title">
          <h1>Memory</h1>
        </div>
        <div className="pk-detail__spacer" />
        <span className="pk-detail__meta">{workspace.name}</span>
      </div>
      <div
        className="pk-detail__body"
        style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 920 }}
      >
        <MemoryEditor
          scope={{ type: 'workspace', id: workspace.id }}
          title="Workspace memory"
          subtitle=".pluri/memory/workspace.md"
          hint="Product summary, domain glossary, and cross-cutting decisions shared across every repo. Injected into every agent — keep it tight."
        />
        {workspace.repos.map((r) => (
          <MemoryEditor
            key={r.id}
            scope={{ type: 'repo', id: r.id }}
            title={`${r.name} · CLAUDE.md`}
            subtitle={`${r.path}/CLAUDE.md`}
            hint="Stack + versions, codebase map (where things live), conventions, and run/test/lint commands. Read natively by each agent — lets it skip orientation."
            meta={
              r.indexedAt
                ? `indexed ${new Date(r.indexedAt).toLocaleDateString()}`
                : 'never indexed'
            }
          />
        ))}
        {workspace.repos.length === 0 && (
          <span className="pk-form__hint">Add repos to this workspace to edit their CLAUDE.md.</span>
        )}
      </div>
    </div>
  )
}
