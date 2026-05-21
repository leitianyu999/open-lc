import { relations, sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  displayName: text('display_name'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
})

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
})

export const baiduAccounts = sqliteTable(
  'baidu_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    label: text('label').notNull(),
    cookie: text('cookie').notNull(),
    ownerUserId: integer('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    credentialSource: text('credential_source', { enum: ['cookie', 'open_platform'] })
      .notNull()
      .default('cookie'),
    refreshToken: text('refresh_token'),
    accessToken: text('access_token'),
    tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp_ms' }),
    openPlatformDriver: text('open_platform_driver'),
    openPlatformClientKey: text('open_platform_client_key'),
    openPlatformSecretKey: text('open_platform_secret_key'),
    openPlatformServerUse: integer('open_platform_server_use', { mode: 'boolean' }),
    uk: text('uk'),
    baiduName: text('baidu_name'),
    vipType: text('vip_type').notNull().default('unknown'),
    vipLeftSeconds: integer('vip_left_seconds'),
    vipExpiresAt: integer('vip_expires_at', { mode: 'timestamp_ms' }),
    weight: integer('weight').notNull().default(100),
    status: text('status', { enum: ['active', 'disabled', 'cooldown'] })
      .notNull()
      .default('active'),
    reason: text('reason').notNull().default(''),
    disabledSource: text('disabled_source'),
    healthStatus: text('health_status'),
    healthMessage: text('health_message'),
    healthCheckedAt: integer('health_checked_at', { mode: 'timestamp_ms' }),
    loginValid: integer('login_valid', { mode: 'boolean' }),
    bdstokenValid: integer('bdstoken_valid', { mode: 'boolean' }),
    isSvip: integer('is_svip', { mode: 'boolean' }),
    quotaTotalBytes: integer('quota_total_bytes'),
    quotaUsedBytes: integer('quota_used_bytes'),
    quotaFreeBytes: integer('quota_free_bytes'),
    healthConsecutiveFailures: integer('health_consecutive_failures').notNull().default(0),
    healthLastErrorCode: text('health_last_error_code'),
    tokenStatus: text('token_status', { enum: ['valid', 'refreshed', 'invalid', 'reimport_required', 'unknown'] }),
    tokenCheckedAt: integer('token_checked_at', { mode: 'timestamp_ms' }),
    tokenMessage: text('token_message'),
    tokenLastErrorCode: text('token_last_error_code'),
    tokenLastRefreshedAt: integer('token_last_refreshed_at', { mode: 'timestamp_ms' }),
    lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
    cooldownUntil: integer('cooldown_until', { mode: 'timestamp_ms' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
    lastFailureAt: integer('last_failure_at', { mode: 'timestamp_ms' }),
    lastFailureCode: text('last_failure_code'),
    createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    statusIdx: index('baidu_accounts_status_idx').on(table.status),
    ownerIdx: index('baidu_accounts_owner_idx').on(table.ownerUserId),
    ukUnique: uniqueIndex('baidu_accounts_uk_unique').on(table.uk).where(sql`${table.uk} IS NOT NULL AND ${table.uk} != ''`),
  }),
)

export const accountHealthChecks = sqliteTable(
  'account_health_checks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => baiduAccounts.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    code: text('code'),
    message: text('message').notNull(),
    deterministic: integer('deterministic', { mode: 'boolean' }).notNull().default(false),
    loginValid: integer('login_valid', { mode: 'boolean' }),
    bdstokenValid: integer('bdstoken_valid', { mode: 'boolean' }),
    isSvip: integer('is_svip', { mode: 'boolean' }),
    vipLeftSeconds: integer('vip_left_seconds'),
    vipExpiresAt: integer('vip_expires_at', { mode: 'timestamp_ms' }),
    quotaTotalBytes: integer('quota_total_bytes'),
    quotaUsedBytes: integer('quota_used_bytes'),
    quotaFreeBytes: integer('quota_free_bytes'),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    accountCreatedIdx: index('account_health_checks_account_created_idx').on(table.accountId, table.createdAt),
    createdIdx: index('account_health_checks_created_idx').on(table.createdAt),
  }),
)

export const accountStatusEvents = sqliteTable(
  'account_status_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => baiduAccounts.id, { onDelete: 'cascade' }),
    oldStatus: text('old_status'),
    newStatus: text('new_status').notNull(),
    oldReason: text('old_reason'),
    newReason: text('new_reason'),
    source: text('source').notNull(),
    code: text('code'),
    message: text('message').notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    parseJobId: integer('parse_job_id'),
    parseRecordId: integer('parse_record_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    accountCreatedIdx: index('account_status_events_account_created_idx').on(table.accountId, table.createdAt),
  }),
)

export const accountTokenEvents = sqliteTable(
  'account_token_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => baiduAccounts.id, { onDelete: 'cascade' }),
    parseJobId: integer('parse_job_id'),
    trigger: text('trigger').notNull(),
    action: text('action').notNull(),
    status: text('status').notNull(),
    code: text('code'),
    message: text('message').notNull(),
    accessTokenUsableBefore: integer('access_token_usable_before', { mode: 'boolean' }),
    accessTokenUsableAfter: integer('access_token_usable_after', { mode: 'boolean' }),
    tokenExpiresAt: integer('token_expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    accountCreatedIdx: index('account_token_events_account_created_idx').on(table.accountId, table.createdAt),
    createdIdx: index('account_token_events_created_idx').on(table.createdAt),
  }),
)

export const parseRecords = sqliteTable(
  'parse_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: integer('account_id').references(() => baiduAccounts.id, { onDelete: 'set null' }),
    accountOwnerUserId: integer('account_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    shareSurl: text('share_surl').notNull(),
    shareUrl: text('share_url'),
    pwd: text('pwd'),
    dir: text('dir'),
    fsId: text('fs_id').notNull(),
    filename: text('filename').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    md5: text('md5'),
    status: text('status', { enum: ['success', 'failed'] }).notNull(),
    route: text('route'),
    credentialSource: text('credential_source', { enum: ['cookie', 'open_platform'] })
      .notNull()
      .default('cookie'),
    parseRoute: text('parse_route', { enum: ['sharedownload', 'transfer'] }),
    resultUrl: text('result_url'),
    resultUa: text('result_ua'),
    linkExpiresAt: integer('link_expires_at', { mode: 'timestamp_ms' }),
    errorMessage: text('error_message'),
    attemptCount: integer('attempt_count').notNull().default(0),
    errorCode: text('error_code'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    userCreatedIdx: index('parse_records_user_created_idx').on(table.userId, table.createdAt),
    statusIdx: index('parse_records_status_idx').on(table.status),
  }),
)

export const parseAttempts = sqliteTable('parse_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parseRecordId: integer('parse_record_id').references(() => parseRecords.id, { onDelete: 'cascade' }),
  parseJobId: integer('parse_job_id'),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: integer('account_id').references(() => baiduAccounts.id, { onDelete: 'set null' }),
  fsId: text('fs_id').notNull(),
  status: text('status', { enum: ['success', 'failed'] }).notNull(),
  errorCode: text('error_code'),
  message: text('message'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
})

export const parseJobs = sqliteTable(
  'parse_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parseRecordId: integer('parse_record_id').references(() => parseRecords.id, { onDelete: 'set null' }),
    accountId: integer('account_id').references(() => baiduAccounts.id, { onDelete: 'set null' }),
    shareUrl: text('share_url').notNull(),
    shareSurl: text('share_surl').notNull(),
    pwd: text('pwd'),
    dir: text('dir').notNull().default('/'),
    fsId: text('fs_id').notNull(),
    filename: text('filename').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    md5: text('md5'),
    status: text('status', { enum: ['queued', 'running', 'success', 'failed', 'canceled'] })
      .notNull()
      .default('queued'),
    queueSeq: integer('queue_seq').notNull(),
    route: text('route'),
    credentialSource: text('credential_source', { enum: ['cookie', 'open_platform'] })
      .notNull()
      .default('cookie'),
    parseRoute: text('parse_route', { enum: ['sharedownload', 'transfer'] }),
    accountOwnerUserId: integer('account_owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    resultUrl: text('result_url'),
    resultUa: text('result_ua'),
    linkExpiresAt: integer('link_expires_at', { mode: 'timestamp_ms' }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    statusSeqIdx: index('parse_jobs_status_seq_idx').on(table.status, table.queueSeq),
    userCreatedIdx: index('parse_jobs_user_created_idx').on(table.userId, table.createdAt),
  }),
)

export const baiduTempFiles = sqliteTable(
  'baidu_temp_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parseRecordId: integer('parse_record_id').references(() => parseRecords.id, { onDelete: 'set null' }),
    parseJobId: integer('parse_job_id').references(() => parseJobs.id, { onDelete: 'set null' }),
    accountId: integer('account_id').references(() => baiduAccounts.id, { onDelete: 'set null' }),
    tempDir: text('temp_dir').notNull(),
    path: text('path').notNull(),
    fsId: text('fs_id'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    status: text('status', { enum: ['active', 'deleted', 'delete_pending', 'delete_failed'] })
      .notNull()
      .default('active'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    statusIdx: index('baidu_temp_files_status_idx').on(table.status),
    accountIdx: index('baidu_temp_files_account_idx').on(table.accountId),
  }),
)

export const parseEvents = sqliteTable(
  'parse_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    parseRecordId: integer('parse_record_id').references(() => parseRecords.id, { onDelete: 'set null' }),
    parseJobId: integer('parse_job_id').references(() => parseJobs.id, { onDelete: 'set null' }),
    accountId: integer('account_id').references(() => baiduAccounts.id, { onDelete: 'set null' }),
    tempFileId: integer('temp_file_id').references(() => baiduTempFiles.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    status: text('status').notNull().default('info'),
    code: text('code'),
    message: text('message').notNull(),
    details: text('details'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    recordIdx: index('parse_events_record_idx').on(table.parseRecordId, table.createdAt),
    jobIdx: index('parse_events_job_idx').on(table.parseJobId, table.createdAt),
  }),
)

export const brokerRuns = sqliteTable(
  'broker_runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    participationId: text('participation_id'),
    status: text('status', {
      enum: [
        'idle',
        'polling',
        'participating',
        'waiting',
        'active',
        'parsing',
        'submitting',
        'success',
        'failed',
        'not_selected',
        'expired',
        'submitted_success',
        'submitted_failure',
      ],
    }).notNull(),
    failureCode: text('failure_code'),
    message: text('message').notNull().default(''),
    provider: text('provider'),
    fileId: text('file_id'),
    fileName: text('file_name'),
    fileSizeBytes: integer('file_size_bytes'),
    localParseRecordId: integer('local_parse_record_id').references(() => parseRecords.id, { onDelete: 'set null' }),
    nextPollAt: integer('next_poll_at', { mode: 'timestamp_ms' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    taskIdx: index('broker_runs_task_idx').on(table.taskId),
    participationIdx: index('broker_runs_participation_idx').on(table.participationId),
    statusUpdatedIdx: index('broker_runs_status_updated_idx').on(table.status, table.updatedAt),
  }),
)

export const brokerRunEvents = sqliteTable(
  'broker_run_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').references(() => brokerRuns.id, { onDelete: 'cascade' }),
    taskId: text('task_id'),
    participationId: text('participation_id'),
    type: text('type').notNull(),
    status: text('status', { enum: ['info', 'success', 'failed', 'warning'] })
      .notNull()
      .default('info'),
    code: text('code'),
    message: text('message').notNull(),
    details: text('details'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (table) => ({
    runCreatedIdx: index('broker_run_events_run_created_idx').on(table.runId, table.createdAt),
    taskCreatedIdx: index('broker_run_events_task_created_idx').on(table.taskId, table.createdAt),
    createdIdx: index('broker_run_events_created_idx').on(table.createdAt),
  }),
)

export const usersRelations = relations(users, ({ many }) => ({
  records: many(parseRecords),
}))

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type BaiduAccount = typeof baiduAccounts.$inferSelect
export type ParseRecord = typeof parseRecords.$inferSelect
export type ParseJob = typeof parseJobs.$inferSelect
export type BaiduTempFile = typeof baiduTempFiles.$inferSelect
export type ParseEvent = typeof parseEvents.$inferSelect
export type AccountStatusEvent = typeof accountStatusEvents.$inferSelect
export type AccountTokenEvent = typeof accountTokenEvents.$inferSelect
export type BrokerRun = typeof brokerRuns.$inferSelect
export type BrokerRunEvent = typeof brokerRunEvents.$inferSelect
