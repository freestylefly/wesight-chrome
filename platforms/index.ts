import { bilibiliAdapter } from "~platforms/bilibili"
import { csdnAdapter } from "~platforms/csdn"
import { juejinAdapter } from "~platforms/juejin"
import type { PlatformAdapter } from "~platforms/types"
import { zhihuAdapter } from "~platforms/zhihu"
import type { PlatformId } from "~types/protocol"

export const PLATFORM_ADAPTERS: Record<PlatformId, PlatformAdapter> = {
  zhihu: zhihuAdapter,
  csdn: csdnAdapter,
  juejin: juejinAdapter,
  "bilibili-article": bilibiliAdapter
}
