import type {ToolDefinition} from '../ToolDefinition.js'

import {create} from './create.js'
import {destroy} from './destroy.js'
import {list} from './list.js'
import {pressKey} from './press.js'
import {read} from './read.js'
import {reset} from './reset.js'
import {resize} from './resize.js'
import {screenshot} from './screenshot.js'
import {select} from './select.js'
import {typeText} from './type.js'

export const TOOLS: ToolDefinition[] = [
  create,
  destroy,
  list,
  pressKey,
  read,
  reset,
  resize,
  screenshot,
  select,
  typeText
].sort((a, b) => a.name.localeCompare(b.name)) as ToolDefinition[]
