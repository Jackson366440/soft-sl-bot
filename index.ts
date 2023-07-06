import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
const { eventEmitter } = require('./commands/prod/set-soft-sl.js');
import {
    Client,
    Collection,
    Events,
    GatewayIntentBits,
    User,
    Channel,
    TextChannel,
} from 'discord.js';
import {
    FuturesClient,
    DefaultLogger,
    WsTopic,
    WebsocketClient,
    NewFuturesOrder,
} from 'bitget-api';
import { text } from 'stream/consumers';

config();

declare module 'discord.js' {
    interface Client {
        commands: Collection<string, any>;
    }
}

const API_KEY = process.env.API_KEY_COM;
const API_SECRET = process.env.API_SECRET_COM;
const API_PASS = process.env.API_PASS_COM;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const bitgetClient = new FuturesClient({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    apiPass: API_PASS,
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

client.login(DISCORD_TOKEN);

client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
});

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

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
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

eventEmitter.on('softSlSet', async ({ coin, direction, price, timeframe }: { coin: string, direction: string, price: number, timeframe: string }) => {
    try {
        console.log('Received soft SL data:', { coin, direction, price, timeframe });
        coin += 'USDT_UMCBL';
        timeframe = 'candle' + timeframe;

        const logger = {
            ...DefaultLogger,
        };

        const wsClient = new WebsocketClient({}, logger,);

        let isSnapshotUpdate = true;

        wsClient.on('update', (data) => {
            if (data.arg.instType === 'mc' && data.arg.channel === timeframe.toString() && data.arg.instId === coin.replace('_UMCBL', '')) {
                if (isSnapshotUpdate) {
                    isSnapshotUpdate = false;
                    return;
                }
                const openPrice = parseFloat(data.data[0][1]);
                const closePrice = parseFloat(data.data[0][4]);
                if ((openPrice < price && direction === 'long') || (openPrice > price && direction === 'short')) {
                    console.log(`closed above ${price} @ ${closePrice}, closing position`);
                    // close position
                    eventEmitter.emit('slTriggered', closePrice);
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

        eventEmitter.on('slTriggered', async (closePrice: GLfloat) => {
            try {
                console.log('slTriggered event fired');
                const closingSide = direction === 'long' ? 'close_long' : 'close_short';
                const closingOrder: NewFuturesOrder = {
                    marginCoin: slPosition.marginCoin,
                    orderType: 'market',
                    side: closingSide,
                    size: slPosition.available,
                    symbol: slPosition.symbol,
                };
                console.log('closing position with market order: ', closingOrder);
                const result = await bitgetClient.submitOrder(closingOrder);
                console.log('position closing order result: ', result);

                //change this to env variable
                //also need to check if there already is a soft sl placed for that position--if so, do not allow to add 2nd
                //& add command to delete sl's
                //& command to list active sl's
                //& command to add api info
                //for api storing use mongodb
                const channel = client.channels.cache.get('1126214053430317196');
                if (channel) {
                    const textchannel = channel as TextChannel;
                    //change this to mention specific user
                    textchannel.send(`<@811090676284260372> Soft SL triggered--\`${coin} ${direction}\` closed @ ${closePrice}`);
                }
            } catch (error) {
                console.error('Error while closing position:', error);
            }
        });

        eventEmitter.emit('slPosFound', slPosition.averageOpenPrice, slPosition.margin, slPosition.leverage, slPosition.available, direction === 'long' ? 'below' : 'above');

        wsClient.subscribeTopic('MC', timeframe as WsTopic, coin.replace('_UMCBL', ''));
    } catch (e) {
        console.error('request failed: ', e);
    }
});