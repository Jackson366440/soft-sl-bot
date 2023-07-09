const {
	SlashCommandBuilder,
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	ActionRowBuilder,
	ComponentType,
	ButtonBuilder,
	ButtonStyle,
} = require('discord.js');
const {
	FuturesClient,
} = require('bitget-api');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { config } = require('dotenv');
const { EventEmitter } = require('events');

const eventEmitter = new EventEmitter();

config();

const uri = process.env.MONGODB_URI;

module.exports = {
	data: new SlashCommandBuilder()
		.setName('test-set-soft-sl')
		.setDescription('Set soft SL')
		.addNumberOption(option =>
			option.setName('price')
				.setDescription('Price of soft stop loss')
				.setRequired(true))
		.addStringOption(option =>
			option.setName('timeframe')
				.setDescription('Timeframe to look for candle close on')
				.setRequired(true)
				.addChoices(
					{ name: '1m', value: '1m' },
					{ name: '5m', value: '5m' },
					{ name: '15m', value: '15m' },
					{ name: '30m', value: '30m' },
					{ name: '1H', value: '1H' },
					{ name: '4H', value: '4H' },
					{ name: '6H', value: '6H' },
					{ name: '12H', value: '12H' },
					{ name: '1D', value: '1D' },
				)),
	async execute(interaction) {
		const userId = interaction.user.id;
		const price = interaction.options.getNumber('price');
		const timeframe = interaction.options.getString('timeframe');

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
			const activeSLsCollection = database.collection('active_sls');

			const userKeys = await collection.findOne({ userId });

			if (!userKeys) {
				await interaction.editReply({ content: 'No API keys found for the user. Add one using /add-bitget-api', ephemeral: true });
				return;
			}

			// Fetch active positions for the user
			const bitgetClient = new FuturesClient({
				apiKey: userKeys.API_KEY,
				apiSecret: userKeys.API_SECRET,
				apiPass: userKeys.API_PASS,
			});

			const positionsResult = await bitgetClient.getPositions('umcbl');
			const activePositions = positionsResult.data.filter(
				(pos) => pos.total !== '0',
			);

			if (activePositions.length === 0) {
				await interaction.editReply({ content: 'You have no active positions.', ephemeral: true });
				return;
			}

			const selectOptions = activePositions.map((position) => {
				return new StringSelectMenuOptionBuilder()
					.setLabel(`${position.symbol} ${position.holdSide}`)
					.setValue(position.symbol + ' ' + position.holdSide);
			});

			const select = new StringSelectMenuBuilder()
				.setCustomId('select-position')
				.setPlaceholder('Select an active position')
				.setOptions(selectOptions);

			const row = new ActionRowBuilder()
				.addComponents(select);

			const confirm = new ButtonBuilder()
				.setCustomId('confirm')
				.setLabel('Confirm')
				.setStyle(ButtonStyle.Success);

			const cancel = new ButtonBuilder()
				.setCustomId('cancel')
				.setLabel('Cancel')
				.setStyle(ButtonStyle.Danger);

			const confirmRow = new ActionRowBuilder()
				.addComponents(confirm, cancel);

			const response = await interaction.editReply({
				content: 'Please select an active position to set soft SL on:',
				components: [row],
				ephemeral: true,
			});

			const collector = response.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 3_600_000 });

			collector.on('collect', async i => {
				try {
					await client.connect();
					
					const selection = i.values[0];
					const coin = selection.split(' ')[0];
					const direction = selection.split(' ').pop();

					const existingSL = await activeSLsCollection.findOne({ coin, direction, userId });

					if (existingSL) {
						// An active SL already exists for the position
						await i.update({ content: `A soft SL already exists for this position: \`${existingSL.timeframe} close ${direction === 'long' ? 'below' : 'above'} ${existingSL.price}\``, components: [], ephemeral: true });
						return;
					}

					const confirmResponse = await i.update({
						content: `Are you sure you want to set soft SL on \`${selection}\` at: \`${timeframe} close ${direction === 'long' ? 'below' : 'above'} ${price}\`?`,
						components: [confirmRow],
						ephemeral: true,
					});

					const collectorFilter = i2 => i2.user.id === interaction.user.id;
					try {
						const confirmation = await confirmResponse.awaitMessageComponent({ filter: collectorFilter, time: 60_000 });

						if (confirmation.customId === 'confirm') {
							eventEmitter.emit('softSlSet', { coin, direction, price, timeframe, userId });
							await confirmation.update({
								content: `Soft SL has been set on \`${selection}\` at: \`${timeframe} close ${direction === 'long' ? 'below' : 'above'} ${price}\``,
								components: [],
								ephemeral: true,
							});
						} else if (confirmation.customId === 'cancel') {
							await confirmation.update({ content: 'Action cancelled', components: [], ephemeral: true });
						}
					} catch (e) {
						await interaction.editReply({ content: 'Confirmation not received within 1 minute, cancelling', components: [] });
					}
				} catch (error) {
					console.error('Error connecting to MongoDB client', error);
					await interaction.editReply({ content: 'There was an error while connecting to MongoDB client', components: [], ephemeral: true });
				} finally {
					// Close the MongoDB connection
					await client.close();
				}
			});
		} catch (error) {
			console.error('Error connecting to MongoDB client', error);
			await interaction.editReply({ content: 'There was an error while connecting to MongoDB client', components: [], ephemeral: true });
		} finally {
			// Close the MongoDB connection
			await client.close();
		}
	},
	eventEmitter: eventEmitter,
};