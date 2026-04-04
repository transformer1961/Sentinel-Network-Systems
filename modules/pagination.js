/**
 * PAGINATION MODULE
 * Creates paginated embed responses with Previous/Next buttons.
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const config = require('../config.json');

/**
 * Send a paginated embed response.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object[]} pages - Array of EmbedBuilder objects
 * @param {number} timeout - Milliseconds before buttons deactivate (default 60s)
 */
async function paginate(interaction, pages, timeout = 60000) {
  if (!pages || pages.length === 0) return;

  // Single page — no buttons needed
  if (pages.length === 1) {
    return interaction.reply({ embeds: [pages[0]] });
  }

  let currentPage = 0;

  const buildRow = (page, total, disabled = false) => {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setLabel('◀ PREV')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page === 0),
      new ButtonBuilder()
        .setCustomId('page_indicator')
        .setLabel(`${page + 1} / ${total}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('NEXT ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled || page === pages.length - 1)
    );
  };

  const response = await interaction.reply({
    embeds: [pages[0]],
    components: [buildRow(0, pages.length)],
    fetchReply: true
  });

  // Collect button interactions from the original user only
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeout,
    filter: i => i.user.id === interaction.user.id
  });

  collector.on('collect', async i => {
    if (i.customId === 'prev' && currentPage > 0) currentPage--;
    if (i.customId === 'next' && currentPage < pages.length - 1) currentPage++;

    await i.update({
      embeds: [pages[currentPage]],
      components: [buildRow(currentPage, pages.length)]
    });
  });

  collector.on('end', async () => {
    try {
      await response.edit({
        components: [buildRow(currentPage, pages.length, true)]
      });
    } catch {
      // Message may have been deleted
    }
  });
}

/**
 * Split an array of items into pages of a given size.
 * @param {any[]} items
 * @param {number} pageSize
 * @returns {any[][]}
 */
function chunkArray(items, pageSize) {
  const pages = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages;
}

module.exports = { paginate, chunkArray };
