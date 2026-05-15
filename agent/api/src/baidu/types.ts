export type CredentialSource = 'cookie' | 'open_platform'

export type ParseRoute = 'sharedownload' | 'transfer'

export type ShareFile = {
  category: number
  fs_id: number
  is_dir: boolean
  local_ctime: number
  local_mtime: number
  md5: string
  path: string
  server_ctime: number
  server_mtime: number
  server_filename: string
  size: number
  dlink: string
}

export type DiskFile = ShareFile

export type DiskListResult = {
  dir: string
  list: DiskFile[]
}

export type ShareListResult = {
  uk: number
  shareid: number
  randsk: string
  uname: string
  list: ShareFile[]
}

export type ShareSignResult = {
  sign: string
  timestamp: number
}

export type SavedFile = {
  from: string
  from_fs_id: number
  to: string
  to_fs_id: number
}

export type ParsedLink = {
  message: string
  filename: string
  fs_id: number
  ua: string
  account_id: string
  urls: string[]
}
