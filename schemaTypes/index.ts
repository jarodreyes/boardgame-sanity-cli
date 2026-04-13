import {defineField, defineType} from 'sanity'

const boardGameType = defineType({
  name: 'boardGame',
  title: 'Board Game',
  type: 'document',
  fields: [
    defineField({name: 'bggId', title: 'BGG ID', type: 'number'}),
    defineField({name: 'name', title: 'Name', type: 'string'}),
    defineField({name: 'yearPublished', title: 'Year Published', type: 'number'}),
    defineField({name: 'minPlayers', title: 'Min Players', type: 'number'}),
    defineField({name: 'maxPlayers', title: 'Max Players', type: 'number'}),
    defineField({name: 'minPlaytime', title: 'Min Playtime (min)', type: 'number'}),
    defineField({name: 'maxPlaytime', title: 'Max Playtime (min)', type: 'number'}),
    defineField({name: 'averageRating', title: 'BGG Average Rating', type: 'number'}),
    defineField({name: 'weight', title: 'Complexity Weight (1–5)', type: 'number'}),
    defineField({
      name: 'categories',
      title: 'Categories',
      type: 'array',
      of: [{type: 'string'}],
    }),
    defineField({
      name: 'mechanics',
      title: 'Mechanics',
      type: 'array',
      of: [{type: 'string'}],
    }),
    defineField({
      name: 'designers',
      title: 'Designers',
      type: 'array',
      of: [{type: 'string'}],
    }),
  ],
})

export const schemaTypes = [boardGameType]