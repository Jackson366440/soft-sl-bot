const { SlashCommandBuilder } = require('discord.js');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { config } = require('dotenv');

config();

const uri = process.env.MONGODB_URI;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add-bitget-api')
        .setDescription('Add or update a Bitget API - mandatory for usage')
        .addStringOption(option =>
            option.setName('key')
                .setDescription('API Key')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('secret')
                .setDescription('API Secret')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('pass')
                .setDescription('API Password')
                .setRequired(true)),
    async execute(interaction) {
        const userId = interaction.user.id;
        const API_KEY = interaction.options.getString('key');
        const API_SECRET = interaction.options.getString('secret');
        const API_PASS = interaction.options.getString('pass');

        await interaction.deferReply({ ephemeral: true });

        const client = new MongoClient(uri, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
        });

        try {
            await client.connect();

            // Access the soft_sl_bot_db database
            const database = client.db('soft_sl_bot_db');

            // Access the bitget_api_keys collection
            const collection = database.collection('bitget_api_keys');

            // Insert the API data into the collection
            const result = await collection.updateOne(
                { userId },
                { $set: { API_KEY, API_SECRET, API_PASS } },
                { upsert: true },
            );

            console.log('API data added or updated.');

            if (result.upsertedCount > 0) {
                await interaction.followUp({ content: 'Bitget API added successfully!', ephemeral: true });
            } else {
                await interaction.followUp({ content: 'Bitget API updated successfully!', ephemeral: true });
            }
        } catch (error) {
            console.error('Error adding API data:', error);

            await interaction.followUp({ content: 'Failed to add Bitget API. Please try again.', ephemeral: true });
        } finally {
            // Close the MongoDB connection
            await client.close();
        }
    },
};