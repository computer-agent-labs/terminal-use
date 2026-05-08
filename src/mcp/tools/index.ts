import type {ToolDefinition} from '../ToolDefinition.js'

import {pressKey} from './press.js'
import {read} from './read.js'
import {reset} from './reset.js'
import {resize} from './resize.js'
import {screenshot} from './screenshot.js'
import {typeText} from './type.js'

export const TOOLS: ToolDefinition[] = [pressKey, read, reset, resize, screenshot, typeText].sort(
  (a, b) => a.name.localeCompare(b.name)
) as ToolDefinition[]
