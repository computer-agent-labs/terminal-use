import type {ToolDefinition} from '../ToolDefinition.js'

import {batch} from './batch.js'
import {click} from './click.js'
import {create} from './create.js'
import {destroy} from './destroy.js'
import {list} from './list.js'
import {pressKey} from './press.js'
import {read} from './read.js'
import {reset} from './reset.js'
import {resize} from './resize.js'
import {screenshot} from './screenshot.js'
import {scroll} from './scroll.js'
import {typeText} from './type.js'
import {wait} from './wait.js'

export const TOOLS: ToolDefinition[] = [
  batch,
  click,
  create,
  destroy,
  list,
  pressKey,
  read,
  reset,
  resize,
  screenshot,
  scroll,
  typeText,
  wait
].sort((a, b) => a.name.localeCompare(b.name)) as ToolDefinition[]
