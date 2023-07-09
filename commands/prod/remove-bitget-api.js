const { SlashCommandBuilder } = require('discord.js');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { config } = require('dotenv');

config();

const uri = process.env.MONGODB_URI;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-bitget-api')
        .setDescription('Remove Bitget API from the database'),
    async execute(interaction) {
        const userId = interaction.user.id;

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

            // Delete the API data from the collection
            const result = await collection.deleteOne({ userId });

            console.log('Bitget API removed from database.');

            if (result.deletedCount > 0) {
                await interaction.followUp({ content: 'Bitget API removed successfully!', ephemeral: true });
            } else {
                await interaction.followUp({ content: 'No Bitget API found for the specified user.', ephemeral: true });
            }
        } catch (error) {
            console.error('Error removing Bitget API:', error);
            await interaction.reply({ content: 'There was an error while removing the Bitget API.', ephemeral: true });
        } finally {
            // Close the MongoDB connection
            await client.close();
        }
    },
};