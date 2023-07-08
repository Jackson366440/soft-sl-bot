const { SlashCommandBuilder } = require('discord.js');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { config } = require('dotenv');

config();

const uri = process.env.MONGODB_URI;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cancel-soft-sl')
        .setDescription('Cancel a soft SL')
        .addStringOption(option =>
            option.setName('coin')
                .setDescription('Coin symbol')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('direction')
                .setDescription('Direction of the position (long or short)')
                .setRequired(true)
                .addChoices(
                    { name: 'long', value: 'long' },
                    { name: 'short', value: 'short' },
                )),
    async execute(interaction) {
        const userId = interaction.user.id;
        const coin = interaction.options.getString('coin').toUpperCase() + 'USDT_UMCBL';
        const direction = interaction.options.getString('direction');

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

            // Access the active_sls collection
            const collection = database.collection('active_sls');

            // Find and delete the SL for the specified coin, direction, and user
            const result = await collection.deleteOne({ userId, coin, direction });

            if (result.deletedCount > 0) {
                await interaction.followUp({ content: `Soft SL for ${coin} ${direction} has been canceled successfully.`, ephemeral: true });
            } else {
                await interaction.followUp({ content: `No active soft SL found for ${coin} ${direction} for the specified user.`, ephemeral: true });
            }
        } catch (error) {
            console.error('Error canceling soft SL:', error);
            await interaction.followUp({ content: 'There was an error while canceling the soft SL.', ephemeral: true });
        } finally {
            // Close the MongoDB connection
            await client.close();
        }
    },
};
