/**
 * Migrações do banco. Cada item do array é aplicado uma única vez, em ordem,
 * e a versão aplicada fica em `PRAGMA user_version`.
 * Para evoluir o schema: acrescente um NOVO item ao final — nunca edite os antigos.
 *
 * Datas são strings ISO-8601 UTC (ordenáveis como texto).
 */
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const MIGRATIONS: string[] = [
  /* v1 — schema inicial */
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE videos (
    id                  TEXT PRIMARY KEY,
    original_name       TEXT NOT NULL,
    file_path           TEXT NOT NULL,           -- relativo à pasta de armazenamento
    mime                TEXT NOT NULL,
    size_bytes          INTEGER NOT NULL,
    duration_sec        REAL,
    source              TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','url')),
    source_url          TEXT,
    transcript          TEXT,                    -- cache da transcrição (Whisper) para reuso
    transcript_language TEXT,
    created_at          TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE avatars (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,                   -- descrição do personagem, em inglês
    created_at  TEXT NOT NULL DEFAULT (${NOW}),
    updated_at  TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE avatar_photos (
    id            TEXT PRIMARY KEY,
    avatar_id     TEXT NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
    file_path     TEXT NOT NULL,
    original_name TEXT NOT NULL,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_avatar_photos_avatar ON avatar_photos(avatar_id, position);

  CREATE TABLE jobs (
    id                 TEXT PRIMARY KEY,
    title              TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','running','completed','partial','failed','cancelled')),
    video_id           TEXT REFERENCES videos(id) ON DELETE RESTRICT,
    avatar_id          TEXT REFERENCES avatars(id) ON DELETE SET NULL,
    -- Cópia do avatar no momento do disparo: o histórico não muda se o avatar for editado/excluído.
    avatar_name        TEXT NOT NULL,
    avatar_description TEXT NOT NULL,
    transcript         TEXT NOT NULL DEFAULT '',
    transcript_source  TEXT NOT NULL DEFAULT 'none' CHECK (transcript_source IN ('whisper','manual','none')),
    copy_text          TEXT NOT NULL DEFAULT '',
    language           TEXT NOT NULL DEFAULT 'pt',
    format             TEXT NOT NULL,
    variations         INTEGER NOT NULL,
    model              TEXT NOT NULL,
    resolution         TEXT NOT NULL,
    planned_videos     INTEGER NOT NULL,
    planned_images     INTEGER NOT NULL,
    max_generations    INTEGER NOT NULL,         -- teto de gerações (inclui folga para refazer)
    generations_used   INTEGER NOT NULL DEFAULT 0,
    failed_attempts    INTEGER NOT NULL DEFAULT 0,
    error              TEXT,
    created_at         TEXT NOT NULL DEFAULT (${NOW}),
    started_at         TEXT,
    finished_at        TEXT
  );
  CREATE INDEX idx_jobs_status ON jobs(status, created_at);

  CREATE TABLE job_items (
    id             TEXT PRIMARY KEY,
    job_id         TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('image','video')),
    variation      INTEGER NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','done','failed','cancelled')),
    attempts       INTEGER NOT NULL DEFAULT 0,
    file_path      TEXT,
    is_placeholder INTEGER NOT NULL DEFAULT 1,
    error          TEXT,
    ready_at       INTEGER,                      -- epoch ms em que o worker conclui o item em andamento
    finished_at    TEXT,
    UNIQUE (job_id, kind, variation)
  );
  CREATE INDEX idx_job_items_job ON job_items(job_id, status);

  CREATE TABLE google_accounts (
    id                 TEXT PRIMARY KEY,
    email              TEXT NOT NULL UNIQUE,
    label              TEXT,
    credits            INTEGER NOT NULL DEFAULT 0,
    enabled            INTEGER NOT NULL DEFAULT 1,
    cycle_videos       INTEGER NOT NULL DEFAULT 0,   -- uso no ciclo atual
    cycle_images       INTEGER NOT NULL DEFAULT 0,
    total_videos       INTEGER NOT NULL DEFAULT 0,   -- uso histórico
    total_images       INTEGER NOT NULL DEFAULT 0,
    last_used_at       TEXT,
    credits_updated_at TEXT,
    created_at         TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE gemini_keys (
    id             TEXT PRIMARY KEY,
    label          TEXT,
    api_key        TEXT NOT NULL UNIQUE,
    enabled        INTEGER NOT NULL DEFAULT 1,
    uses           INTEGER NOT NULL DEFAULT 0,
    last_used_at   TEXT,
    cooldown_until TEXT,
    last_error     TEXT,
    created_at     TEXT NOT NULL DEFAULT (${NOW})
  );

  -- Linha única: número do ciclo de rotação atual.
  CREATE TABLE rotation_state (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    cycle            INTEGER NOT NULL DEFAULT 1,
    cycle_started_at TEXT NOT NULL
  );
  INSERT INTO rotation_state (id, cycle, cycle_started_at) VALUES (1, 1, ${NOW});

  -- Linha única: pareamento com a extensão Chrome.
  CREATE TABLE extension_link (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    pairing_code    TEXT,
    code_expires_at TEXT,
    pair_attempts   INTEGER NOT NULL DEFAULT 0,
    token_hash      TEXT,                        -- SHA-256 do token; o token em si nunca é guardado
    device_name     TEXT,
    paired_at       TEXT,
    last_seen_at    TEXT
  );
  INSERT INTO extension_link (id) VALUES (1);
  `,

  /* v2 — alinhamento com a plataforma de referência
   *  - contas e chaves passam a ter PRIORIDADE (ordem de uso definida pelo usuário);
   *  - chaves Gemini: segredo criptografado (+ final em claro só para exibir máscara),
   *    sem "descanso"/ativar-desativar (a referência só ordena e remove);
   *  - trabalhos: planned_videos/planned_images eram derivados de `variations` → removidos;
   *  - extensão: vários navegadores pareados (antes: linha única) e códigos de pareamento próprios. */
  `
  ALTER TABLE google_accounts ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
  UPDATE google_accounts SET position = rowid;

  ALTER TABLE gemini_keys ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE gemini_keys ADD COLUMN key_last4 TEXT NOT NULL DEFAULT '';
  UPDATE gemini_keys SET position = rowid, key_last4 = substr(api_key, -4);
  ALTER TABLE gemini_keys DROP COLUMN enabled;
  ALTER TABLE gemini_keys DROP COLUMN cooldown_until;

  ALTER TABLE jobs DROP COLUMN planned_videos;
  ALTER TABLE jobs DROP COLUMN planned_images;

  CREATE TABLE extension_browsers (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    token_hash           TEXT NOT NULL UNIQUE,    -- SHA-256 do token; o token em si nunca é guardado
    version              TEXT,
    flow_session_active  INTEGER NOT NULL DEFAULT 0,
    flow_account_email   TEXT,                    -- conta Google logada na aba do Flow (reportada pela extensão)
    paired_at            TEXT NOT NULL,
    last_seen_at         TEXT NOT NULL
  );

  CREATE TABLE pairing_codes (
    code         TEXT PRIMARY KEY,
    browser_name TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (${NOW})
  );

  INSERT INTO extension_browsers (id, name, token_hash, paired_at, last_seen_at)
    SELECT lower(hex(randomblob(16))), COALESCE(device_name, 'Chrome'), token_hash,
           COALESCE(paired_at, ${NOW}), COALESCE(last_seen_at, ${NOW})
    FROM extension_link WHERE token_hash IS NOT NULL;
  DROP TABLE extension_link;
  `,

  /* v3 — Estúdio completo (etapas 2–4 do wizard, transcrição como trabalho, detalhe do trabalho)
   *  - avatares ganham descrição de VOZ (exibida na escolha de avatares);
   *  - catálogo de produtos (campo opcional do trabalho);
   *  - trabalhos têm TIPO (geração | transcrição), produto, formato criativo, modo do roteiro,
   *    modelo de imagem, CTA e snapshots em JSON de avatares, eixos de variação e cenas;
   *  - eventos do trabalho ("Etapas registradas"). */
  `
  ALTER TABLE avatars ADD COLUMN voice TEXT NOT NULL DEFAULT '';

  ALTER TABLE videos ADD COLUMN transcript_scenes TEXT;     -- JSON [{index,start,end,text}] da última transcrição

  CREATE TABLE products (
    id       TEXT PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL DEFAULT 0
  );

  ALTER TABLE jobs ADD COLUMN kind            TEXT NOT NULL DEFAULT 'generation' CHECK (kind IN ('generation','transcription'));
  ALTER TABLE jobs ADD COLUMN product         TEXT;
  ALTER TABLE jobs ADD COLUMN creative_format TEXT NOT NULL DEFAULT 'original-recipe';
  ALTER TABLE jobs ADD COLUMN script_mode     TEXT NOT NULL DEFAULT 'keep';
  ALTER TABLE jobs ADD COLUMN image_model     TEXT NOT NULL DEFAULT 'nano-banana-2.1';
  ALTER TABLE jobs ADD COLUMN cta             TEXT NOT NULL DEFAULT '';     -- '' = sem CTA; senão, o texto
  ALTER TABLE jobs ADD COLUMN avatars_json    TEXT NOT NULL DEFAULT '[]';   -- snapshot dos avatares usados (vazio = pessoa original)
  ALTER TABLE jobs ADD COLUMN axes_json       TEXT NOT NULL DEFAULT '{}';   -- eixos de variação (roupa/cenário/objeto)
  ALTER TABLE jobs ADD COLUMN scenes_json     TEXT NOT NULL DEFAULT '[]';   -- cenas da fala (≤ 8 s cada)

  CREATE TABLE job_events (
    id         TEXT PRIMARY KEY,
    job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done','failed')),
    created_at TEXT NOT NULL DEFAULT (${NOW})
  );
  CREATE INDEX idx_job_events_job ON job_events(job_id, created_at);
  `,

  /* v4 — endurecimento (revisão)
   *  - jobs é reconstruída: CHECKs em formato criativo/modo do roteiro/modelo de imagem, `queued_at`
   *    (ordem da fila; reenfileirar não fura mais a fila) e backfill de `avatars_json` dos trabalhos legados;
   *  - gemini_keys é reconstruída: some o UNIQUE(api_key) (inútil com criptografia de IV aleatório) e entra
   *    `key_hash` (HMAC) UNIQUE para detectar duplicadas; some `label` (não usado);
   *  - contas ganham `tier` (plano), avatares ganham escopo (pessoal/global), gênero e idade;
   *  - navegadores guardam quando o estado da sessão do Flow foi informado (TTL no heartbeat).
   * A reconstrução exige foreign_keys=OFF; quem aplica as migrações (lib/migrate.ts) cuida disso e confere
   * `PRAGMA foreign_key_check` ao final. */
  `
  ALTER TABLE google_accounts ADD COLUMN tier TEXT NOT NULL DEFAULT 'UNKNOWN';

  ALTER TABLE avatars ADD COLUMN scope  TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal','global'));
  ALTER TABLE avatars ADD COLUMN gender TEXT;
  ALTER TABLE avatars ADD COLUMN age    INTEGER;

  ALTER TABLE extension_browsers ADD COLUMN flow_reported_at TEXT;

  CREATE TABLE gemini_keys_new (
    id           TEXT PRIMARY KEY,
    api_key      TEXT NOT NULL,                  -- segredo criptografado (lib/crypto.ts)
    key_hash     TEXT UNIQUE,                    -- HMAC-SHA256 do segredo: detecta duplicadas sem decifrar
    key_last4    TEXT NOT NULL DEFAULT '',
    position     INTEGER NOT NULL DEFAULT 0,
    uses         INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    last_error   TEXT,
    created_at   TEXT NOT NULL DEFAULT (${NOW})
  );
  INSERT INTO gemini_keys_new (id, api_key, key_last4, position, uses, last_used_at, last_error, created_at)
    SELECT id, api_key, key_last4, position, uses, last_used_at, last_error, created_at FROM gemini_keys;
  DROP TABLE gemini_keys;
  ALTER TABLE gemini_keys_new RENAME TO gemini_keys;

  CREATE TABLE jobs_new (
    id                 TEXT PRIMARY KEY,
    kind               TEXT NOT NULL DEFAULT 'generation' CHECK (kind IN ('generation','transcription')),
    title              TEXT NOT NULL,
    product            TEXT,
    status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','running','completed','partial','failed','cancelled')),
    video_id           TEXT REFERENCES videos(id) ON DELETE RESTRICT,
    avatar_id          TEXT REFERENCES avatars(id) ON DELETE SET NULL,
    avatar_name        TEXT NOT NULL,
    avatar_description TEXT NOT NULL,
    transcript         TEXT NOT NULL DEFAULT '',
    transcript_source  TEXT NOT NULL DEFAULT 'none' CHECK (transcript_source IN ('whisper','manual','none')),
    copy_text          TEXT NOT NULL DEFAULT '',
    language           TEXT NOT NULL DEFAULT 'original',
    format             TEXT NOT NULL,
    variations         INTEGER NOT NULL,
    model              TEXT NOT NULL,
    resolution         TEXT NOT NULL,
    max_generations    INTEGER NOT NULL,
    generations_used   INTEGER NOT NULL DEFAULT 0,
    failed_attempts    INTEGER NOT NULL DEFAULT 0,
    creative_format    TEXT NOT NULL DEFAULT 'original-recipe' CHECK (creative_format IN
      ('original-recipe','split-screen','car-selfie','home-selfie','american-kitchen','podcast','mirror-selfie',
       'before-after','doctor-office','pov-hands','ugc-testimonial','fat-melting')),
    script_mode        TEXT NOT NULL DEFAULT 'keep' CHECK (script_mode IN ('keep','adapt','new')),
    image_model        TEXT NOT NULL DEFAULT 'nano-banana-2.1' CHECK (image_model IN
      ('nano-banana-2.1','nano-banana-pro','nano-banana-2-lite')),
    cta                TEXT NOT NULL DEFAULT '',
    avatars_json       TEXT NOT NULL DEFAULT '[]',
    axes_json          TEXT NOT NULL DEFAULT '{}',
    scenes_json        TEXT NOT NULL DEFAULT '[]',
    error              TEXT,
    created_at         TEXT NOT NULL DEFAULT (${NOW}),
    queued_at          TEXT NOT NULL DEFAULT (${NOW}),   -- ordem da fila (atualizada ao reenfileirar)
    started_at         TEXT,
    finished_at        TEXT
  );
  INSERT INTO jobs_new (id, kind, title, product, status, video_id, avatar_id, avatar_name, avatar_description,
      transcript, transcript_source, copy_text, language, format, variations, model, resolution, max_generations,
      generations_used, failed_attempts, creative_format, script_mode, image_model, cta,
      avatars_json, axes_json, scenes_json, error, created_at, queued_at, started_at, finished_at)
    SELECT id, kind, title, product, status, video_id, avatar_id, avatar_name, avatar_description,
      transcript, transcript_source, copy_text, language, format, variations, model, resolution, max_generations,
      generations_used, failed_attempts, creative_format, script_mode, image_model, cta,
      CASE WHEN avatars_json = '[]' AND kind = 'generation' AND avatar_name <> 'Pessoa original'
           THEN json_array(json_object('id', COALESCE(avatar_id, ''), 'name', avatar_name,
                                       'description', avatar_description, 'voice', ''))
           ELSE avatars_json END,
      axes_json, scenes_json, error, created_at, created_at, started_at, finished_at
    FROM jobs;
  DROP TABLE jobs;
  ALTER TABLE jobs_new RENAME TO jobs;
  CREATE INDEX idx_jobs_status ON jobs(status, queued_at);
  `,
];
