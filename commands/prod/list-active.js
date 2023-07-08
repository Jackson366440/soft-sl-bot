const { SlashCommandBuilder } = require('discord.js');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { config } = require('dotenv');

config();

const uri = process.env.MONGODB_URI;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list-active')
        .setDescription('List active SLs'),
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

            // Access the active_sls collection
            const collection = database.collection('active_sls');

            // Find all active SLs for the specified user
            const activeSLs = await collection.find({ userId }).toArray();

            if (activeSLs.length > 0) {
                let slList = '';
                activeSLs.forEach((sl, index) => {
                    slList += `${index + 1}. ${sl.coin} ${sl.timeframe} close ${sl.direction === 'long' ? 'below' : 'above'} ${sl.price}\n`;
                });
                await interaction.followUp({ content: 'List of active SLs:\n\n' + slList, ephemeral: true });
            } else {
                await interaction.followUp({ content: 'No active SLs found for the specified user.', ephemeral: true });
            }
        } catch (error) {
            console.error('Error listing active SLs:', error);
            await interaction.followUp({ content: 'There was an error while listing the active SLs.', ephemeral: true });
        } finally {
            // Close the MongoDB connection
            await client.close();
        }
    },
};
