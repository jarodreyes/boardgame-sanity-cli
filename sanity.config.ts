import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {agentContextPlugin} from '@sanity/agent-context/studio'
import {schemaTypes} from './schemaTypes'

export default defineConfig({
  name: 'default',
  title: 'BGG Agent',

  projectId: '31smwi0k',
  dataset: 'production',

  plugins: [structureTool(), visionTool(), agentContextPlugin()],

  schema: {
    types: schemaTypes,
  },
})
