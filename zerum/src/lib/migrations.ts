/**
 * Migrações do banco (data/zerum.db). Cada item do array é aplicado uma única vez, em ordem,
 * e a versão aplicada fica em `PRAGMA user_version`.
 * Para evoluir o schema: acrescente um NOVO item ao final — nunca edite os antigos.
 *
 * Datas são strings ISO-8601 UTC (ordenáveis como texto).
 */
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const MIGRATIONS: string[] = [
  /* v1 — schema inicial: conversas do Diretor, virais, lotes (produção), avatares, log local */
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL                          -- JSON
  );

  -- Viral enviado ("Analisados"). O arquivo fica em data/virais/<hash>.mp4. Nada sai da máquina.
  CREATE TABLE virals (
    id          TEXT PRIMARY KEY,
    hash        TEXT NOT NULL UNIQUE,            -- sha256 do conteúdo: o mesmo vídeo não é guardado duas vezes
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL DEFAULT 'video/mp4',
    size_bytes  INTEGER NOT NULL,
    -- 'preparando' = guardado; a leitura/análise do Diretor é fase futura (exige IA + executor).
    state       TEXT NOT NULL DEFAULT 'preparando' CHECK (state IN ('preparando','analisado')),
    created_at  TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT 'Nova conversa',
    title_manual INTEGER NOT NULL DEFAULT 0,     -- 1 = o usuário renomeou; o título automático não sobrescreve
    mode        TEXT NOT NULL DEFAULT 'viral' CHECK (mode IN ('viral','ideia')),
    viral_id    TEXT REFERENCES virals(id) ON DELETE SET NULL,
    options     TEXT NOT NULL DEFAULT '{}',      -- JSON: palavra, nome do lote, balão, cor, idioma
    created_at  TEXT NOT NULL DEFAULT (${NOW}),
    updated_at  TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

  CREATE TABLE messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('aluna','diretor','sistema')),
    text            TEXT NOT NULL,
    attachments     TEXT NOT NULL DEFAULT '[]',  -- JSON: [{ nome }]
    created_at      TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

  -- Lote = unidade da aba PRODUÇÃO. Nesta fase só existe 'preparando' (e 'cancelado'):
  -- os demais estados já estão no CHECK para a fase do executor não precisar reconstruir a tabela.
  CREATE TABLE batches (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    viral_id        TEXT REFERENCES virals(id) ON DELETE SET NULL,
    source          TEXT NOT NULL CHECK (source IN ('diretor','manual')),
    title           TEXT NOT NULL,
    quantity        INTEGER NOT NULL,
    word            TEXT NOT NULL DEFAULT '',
    batch_name      TEXT NOT NULL DEFAULT '',
    bubble_on       INTEGER NOT NULL DEFAULT 1,
    bubble_color    TEXT NOT NULL DEFAULT '#FFC400',
    language        TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','de','es')),
    request_text    TEXT NOT NULL DEFAULT '',
    state           TEXT NOT NULL DEFAULT 'preparando'
                    CHECK (state IN ('preparando','na_fila','rodando','pronto','falhou','cancelado')),
    created_at      TEXT NOT NULL DEFAULT (${NOW}),
    updated_at      TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_batches_state ON batches(state, created_at DESC);

  -- Log local legível ("estados com log"): viral/lote/ponte. Substitui qualquer chamada externa.
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scope      TEXT NOT NULL CHECK (scope IN ('viral','batch','conversation','bridge')),
    ref_id     TEXT NOT NULL,
    level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','aviso','erro')),
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_events_ref ON events(scope, ref_id, id);

  CREATE TABLE avatars (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (${NOW}),
    updated_at  TEXT NOT NULL DEFAULT (${NOW})
  );

  -- "Sugestão ou bug": fica só neste banco (no original vai para o servidor da 001).
  CREATE TABLE feedback (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('bug','sugestao')),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  `,

  /* v2 — fase 2: fluxos completos locais.
       · virais: metadados reais do MP4 + análise (JSON) e a original (para "voltar à original")
       · avatares: sexo, foto (data/avatares/<hash>.<ext>) e origem
       · batches reconstruída: estado 'parado', caminho/variação/avatares/observações, parar/arquivar
       · videos: um por vídeo do lote; as CENAS derivam de scenes_done/fail_scene (sem linha própria)
       · plans: plano do Diretor aguardando confirmação (requer_confirmacao)
       · events reconstruída: novos escopos (app, video, plan) */
  `
  ALTER TABLE virals ADD COLUMN duration_s REAL;
  ALTER TABLE virals ADD COLUMN width INTEGER;
  ALTER TABLE virals ADD COLUMN height INTEGER;
  ALTER TABLE virals ADD COLUMN has_audio INTEGER;
  ALTER TABLE virals ADD COLUMN analysis TEXT;
  ALTER TABLE virals ADD COLUMN analysis_original TEXT;

  ALTER TABLE avatars ADD COLUMN gender TEXT NOT NULL DEFAULT '';
  ALTER TABLE avatars ADD COLUMN photo_hash TEXT;
  ALTER TABLE avatars ADD COLUMN photo_mime TEXT;
  ALTER TABLE avatars ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';

  CREATE TABLE events_v2 (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    scope      TEXT NOT NULL CHECK (scope IN ('viral','batch','conversation','bridge','app','video','plan')),
    ref_id     TEXT NOT NULL,
    level      TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','aviso','erro')),
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  INSERT INTO events_v2 (id, scope, ref_id, level, message, created_at) SELECT id, scope, ref_id, level, message, created_at FROM events;
  DROP TABLE events;
  ALTER TABLE events_v2 RENAME TO events;
  CREATE INDEX idx_events_ref ON events(scope, ref_id, id);

  CREATE TABLE batches_v2 (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    viral_id        TEXT REFERENCES virals(id) ON DELETE SET NULL,
    source          TEXT NOT NULL CHECK (source IN ('diretor','manual')),
    title           TEXT NOT NULL,
    quantity        INTEGER NOT NULL,
    word            TEXT NOT NULL DEFAULT '',
    batch_name      TEXT NOT NULL DEFAULT '',
    bubble_on       INTEGER NOT NULL DEFAULT 1,
    bubble_color    TEXT NOT NULL DEFAULT '#FFC400',
    language        TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','de','es')),
    request_text    TEXT NOT NULL DEFAULT '',
    state           TEXT NOT NULL DEFAULT 'na_fila'
                    CHECK (state IN ('preparando','na_fila','rodando','parado','pronto','falhou','cancelado')),
    path            TEXT NOT NULL DEFAULT 'igual' CHECK (path IN ('igual','adaptar')),
    variation       TEXT NOT NULL DEFAULT 'sem',
    avatars         TEXT NOT NULL DEFAULT '[]',     -- JSON: nomes de quem aparece (um por vídeo, em rodízio)
    notes           TEXT NOT NULL DEFAULT '',       -- observações ("lei pros roteiros e pras cenas")
    stop_requested  INTEGER NOT NULL DEFAULT 0,     -- "Parar depois dos atuais"
    archived        INTEGER NOT NULL DEFAULT 0,     -- 1 = "Aprovar lote → Vídeos": sai da Produção
    created_at      TEXT NOT NULL DEFAULT (${NOW}),
    updated_at      TEXT NOT NULL DEFAULT (${NOW})
  );
  INSERT INTO batches_v2 (id, conversation_id, viral_id, source, title, quantity, word, batch_name, bubble_on, bubble_color, language, request_text, state, created_at, updated_at)
    SELECT id, conversation_id, viral_id, source, title, quantity, word, batch_name, bubble_on, bubble_color, language, request_text, state, created_at, updated_at FROM batches;
  DROP TABLE batches;
  ALTER TABLE batches_v2 RENAME TO batches;
  CREATE INDEX idx_batches_state ON batches(state, created_at DESC);

  CREATE TABLE videos (
    id           TEXT PRIMARY KEY,
    batch_id     TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    scenes       TEXT NOT NULL DEFAULT '[]',        -- JSON: [{ fala }] — o roteiro de cada cena
    avatar_name  TEXT NOT NULL DEFAULT '',
    state        TEXT NOT NULL DEFAULT 'fila' CHECK (state IN ('fila','gerando','pronto','falhou','cancelado')),
    scenes_total INTEGER NOT NULL DEFAULT 4,
    scenes_done  INTEGER NOT NULL DEFAULT 0,
    fail_scene   INTEGER,
    error        TEXT NOT NULL DEFAULT '',
    attempt      INTEGER NOT NULL DEFAULT 0,
    started_at   INTEGER,                           -- ms desde a época (relógio da simulação)
    finished_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (${NOW}),
    UNIQUE (batch_id, idx)
  );
  CREATE INDEX idx_videos_state ON videos(state, created_at DESC);

  CREATE TABLE plans (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id      TEXT REFERENCES messages(id) ON DELETE SET NULL,
    state           TEXT NOT NULL DEFAULT 'pendente' CHECK (state IN ('pendente','executado','cancelado','substituido')),
    steps           TEXT NOT NULL DEFAULT '[]',     -- JSON: [{ id, texto, gastaCredito }]
    params          TEXT NOT NULL DEFAULT '{}',     -- JSON: PlanParams
    batch_id        TEXT REFERENCES batches(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (${NOW}),
    updated_at      TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_plans_conv ON plans(conversation_id, created_at);
  `,
];
