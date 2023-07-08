import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
const { eventEmitter } = require('./commands/prod/set-soft-sl.js');
import {
    Client,
    Collection,
    Events,
    GatewayIntentBits,
    TextChannel,
} from 'discord.js';
import {
    FuturesClient,
    DefaultLogger,
    WsTopic,
    WebsocketClient,
    NewFuturesOrder,
} from 'bitget-api';
const { MongoClient, ServerApiVersion } = require('mongodb');

config();

const uri = process.env.MONGODB_URI;

declare module 'discord.js' {
    interface Client {
        commands: Collection<string, any>;
    }
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

let bitgetClient = new FuturesClient({});

const mongoClient = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        // Set a new item in the Collection with the key as the command name and the value as the exported module
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

const database = mongoClient.db('soft_sl_bot_db');
const activeSLsCollection = database.collection('active_sls');

client.login(DISCORD_TOKEN);

client.once(Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);

    try {
        await mongoClient.connect();
        console.log('Connected to MongoDB');

        const collection = database.collection('bitget_api_keys');

        client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                const userId = interaction.user.id;

                if (command.data.name !== 'set-soft-sl') {
                    await command.execute(interaction);
                    return;
                }

                const userKeys = await collection.findOne({ userId });

                if (!userKeys) {
                    await interaction.reply({ content: 'No API keys found for the user.', ephemeral: true });
                    return;
                }

                bitgetClient = new FuturesClient({
                    apiKey: userKeys.API_KEY,
                    apiSecret: userKeys.API_SECRET,
                    apiPass: userKeys.API_PASS,
                });

                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
                }
            }
        });

        eventEmitter.on('softSlSet', async ({ coin, direction, price, timeframe, userId }: { coin: string, direction: string, price: number, timeframe: string, userId: any }) => {
            try {
                console.log('Received soft SL data:', { coin, direction, price, timeframe });
                coin += 'USDT_UMCBL';
                timeframe = 'candle' + timeframe;

                const logger = {
                    ...DefaultLogger,
                };

                const wsClient = new WebsocketClient({}, logger,);

                let isSnapshotUpdate = true;

                const positionsResult = await bitgetClient.getPositions('umcbl');
                const openPositions = positionsResult.data.filter(
                    (pos) => pos.total !== '0',
                );
                const slPosition = openPositions.find(
                    (pos) => pos.symbol === coin && pos.holdSide === direction,
                );

                if (!slPosition) {
                    eventEmitter.emit('slPosNotFound');
                    return;
                }

                const existingSL = await activeSLsCollection.findOne({ coin, direction, userId });
                if (existingSL) {
                    // An active SL already exists for the position
                    eventEmitter.emit('existingSlFound', existingSL.price, existingSL.timeframe, direction === 'long' ? 'below' : 'above');
                    return;
                }

                const activeSL = {
                    coin,
                    direction,
                    price,
                    timeframe,
                    userId: userId,
                };

                await activeSLsCollection.insertOne(activeSL);

                eventEmitter.emit('slPosFound', slPosition.averageOpenPrice, slPosition.margin, slPosition.leverage, slPosition.available, direction === 'long' ? 'below' : 'above');

                wsClient.on('update', async (data) => {
                    if (data.arg.instType === 'mc' && data.arg.channel === timeframe.toString() && data.arg.instId === coin.replace('_UMCBL', '')) {
                        if (isSnapshotUpdate) {
                            isSnapshotUpdate = false;
                            return;
                        }

                        const slStillExists = await activeSLsCollection.findOne({ coin, direction, userId });
                        if (!slStillExists) {
                            console.log('SL canceled');
                            wsClient.closeAll();
                            return;
                        }

                        const posResult = await bitgetClient.getPositions('umcbl');
                        const currentPositions = posResult.data.filter(
                            (pos) => pos.total !== '0',
                        );
                        const positionStillOpen = currentPositions.find(
                            (pos) => pos.symbol === coin && pos.holdSide === direction,
                        );
                        if (!positionStillOpen) {
                            console.log('Position manually closed');
                            const result = await activeSLsCollection.deleteOne({ userId, coin, direction });
                            console.log('Removing from DB: ', result);
                            const channel = client.channels.cache.get('1126214053430317196');
                            if (channel) {
                                const textchannel = channel as TextChannel;
                                textchannel.send(`<@${userId}> ${coin} ${direction} manually closed, removing soft SL`);
                            }
                            wsClient.closeAll();
                            return;
                        }

                        const openPrice = parseFloat(data.data[0][1]);
                        const closePrice = parseFloat(data.data[0][4]);
                        if ((openPrice < price && direction === 'long') || (openPrice > price && direction === 'short')) {
                            console.log(`closed above ${price} @ ${closePrice}, closing position`);
                            // close position
                            eventEmitter.emit('slTriggered', coin, direction, positionStillOpen.available, closePrice, userId);
                            wsClient.closeAll();
                            return;
                        }
                    }
                });

                wsClient.on('open', (data) => {
                    console.log('WS connection opened:', data.wsKey);
                });
                wsClient.on('response', (data) => {
                    console.log('WS response: ', JSON.stringify(data, null, 2));
                });
                wsClient.on('reconnect', ({ wsKey }) => {
                    console.log('WS automatically reconnecting.... ', wsKey);
                });
                wsClient.on('reconnected', (data) => {
                    console.log('WS reconnected ', data?.wsKey);
                });
                wsClient.on('exception', (data) => {
                    console.log('WS error', data);
                });

                wsClient.subscribeTopic('MC', timeframe as WsTopic, coin.replace('_UMCBL', ''));
            } catch (e) {
                console.error('request failed: ', e);
            }
        });
    } catch (e) {
        console.error('Error connecting to MongoDB:', e);
    }
});

eventEmitter.on('slTriggered', async (coin: string, direction: string, available: string, closePrice: GLfloat, userId: any) => {
    try {
        console.log('slTriggered event fired');
        const closingSide = direction === 'long' ? 'close_long' : 'close_short';
        const closingOrder: NewFuturesOrder = {
            marginCoin: 'USDT',
            orderType: 'market',
            side: closingSide,
            size: available,
            symbol: coin,
        };
        console.log('closing position with market order: ', closingOrder);
        const result = await bitgetClient.submitOrder(closingOrder);
        console.log('position closing order result: ', result);

        await activeSLsCollection.deleteOne({ coin, direction, userId });

        const channel = client.channels.cache.get('1126214053430317196');
        if (channel) {
            const textchannel = channel as TextChannel;
            textchannel.send(`<@${userId}> Soft SL triggered--\`${coin} ${direction}\` closed @ ${closePrice}`);
        }
    } catch (error) {
        console.error('Error while closing position:', error);
    }
});