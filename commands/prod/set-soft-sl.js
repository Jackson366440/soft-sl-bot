const { SlashCommandBuilder } = require('discord.js');
const { EventEmitter } = require('events');

const eventEmitter = new EventEmitter();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set-soft-sl')
        .setDescription('Set soft SL')
        .addStringOption(option =>
            option.setName('coin')
                .setDescription('must be in format BTC, SOL, XRP, etc. do not add "USDT"')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('direction')
                .setDescription('Set soft SL on long or short position?')
                .setRequired(true)
                .addChoices(
                    { name: 'long', value: 'long' },
                    { name: 'short', value: 'short' },
                ))
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
        const coin = interaction.options.getString('coin').toUpperCase();
        const direction = interaction.options.getString('direction');
        const price = interaction.options.getNumber('price');
        const timeframe = interaction.options.getString('timeframe');

        await interaction.deferReply({ ephemeral: true });

        const slPosNotFoundListener = async () => {
            await interaction.followUp({ content: `An open \`${coin} ${direction}\` position was not found`, ephemeral: true });
            eventEmitter.off('slPosNotFound', slPosNotFoundListener);
            eventEmitter.off('existingSlFound', existingSlFoundListener);
            eventEmitter.off('slPosFound', slPosFoundListener);
        };
        const existingSlFoundListener = async (existingSLPrice, existingSLTimeframe, aboveOrBelow) => {
            await interaction.followUp({ content: `A soft SL already exists for this position:\n\`${existingSLTimeframe} close ${aboveOrBelow} ${existingSLPrice}\``, ephemeral: true });
            eventEmitter.off('slPosNotFound', slPosNotFoundListener);
            eventEmitter.off('existingSlFound', existingSlFoundListener);
            eventEmitter.off('slPosFound', slPosFoundListener);
        };
        const slPosFoundListener = async (entry, margin, leverage, size, aboveOrBelow) => {
            await interaction.followUp({ content: `An open \`${coin} ${direction}\` position was found:\n\`\`\`entry: ${entry}\nmargin: ${margin}\nleverage: ${leverage}\nsize: ${size}\`\`\`\nSoft SL set at \`${timeframe} close ${aboveOrBelow} ${price}\``, ephemeral: true });
            eventEmitter.off('slPosNotFound', slPosNotFoundListener);
            eventEmitter.off('existingSlFound', existingSlFoundListener);
            eventEmitter.off('slPosFound', slPosFoundListener);
        };

        eventEmitter.on('slPosNotFound', slPosNotFoundListener);
        eventEmitter.on('existingSlFound', existingSlFoundListener);
        eventEmitter.on('slPosFound', slPosFoundListener);

        eventEmitter.emit('softSlSet', { coin, direction, price, timeframe, userId });
    },
    eventEmitter: eventEmitter,
};