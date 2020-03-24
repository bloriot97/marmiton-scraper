const axios = require("axios");
const cheerio = require("cheerio");
const pino = require('pino');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const recipeUrl = "https://www.marmiton.org/recettes/recette_"

const dgraph = require("dgraph-js");
const grpc = require("grpc");

const recipeQueue = [{name: "gateau-au-pavot-comme-en-allemagne", rid: 57587}]

const clientStub = new dgraph.DgraphClientStub(
  // addr: optional, default: "localhost:9080"
  "localhost:9080",
  // credentials: optional, default: grpc.credentials.createInsecure()
  grpc.credentials.createInsecure(),
);
const dgraphClient = new dgraph.DgraphClient(clientStub);

const initDgraphSchema = async () => {
    const schema = `
        title: string @index(exact) .
        rid: int @index(int) .
        ingredient: [uid] .
        name: string @index(exact) .
    `;
    const op = new dgraph.Operation();
    op.setSchema(schema);
    await dgraphClient.alter(op);
}

const fetchData = async (url) => {
    const result = await axios.get(url);
    return cheerio.load(result.data);
};

const parseUrl = async ({name, rid}) => {
    var $ = await fetchData(`${recipeUrl}${name}_${rid}.aspx`);
    // console.log($('.recipe-ingredients__list > .recipe-ingredients__list__item'))
    const title = $(".main-title").text()
    const ingredients = $('.recipe-ingredients__list > .recipe-ingredients__list__item').toArray().map(element => {
        const e = $(element)
        const quantity = e.find(".recipe-ingredient-qt").text()
        const ingredient = e.find(".ingredient").text()
        return {
            quantity,
            ingredient
        }
    });
    const steps = $('.recipe-preparation__list__item').toArray().map(e => $(e).text())
    const rating = $('.recipe-infos-users__rating').text()

    const otherRecipes = $('a').toArray().map((e) => {
        return $(e).attr('href') || ""
    }).filter((link) => link.startsWith(recipeUrl)).map((link) => {
        let [name, rid] = link.slice(recipeUrl.length).split('_')
        rid = parseInt(rid.split('.'))
        return {
            name,
            rid
        }
    })

    return {
        rid,
        title,
        ingredients,
        steps,
        rating,
        otherRecipes
    }
}

const ingredientCache = {}

const ingredientUid = async (name) => {
    const query = `query all($name: string) {
        ingredient(func: eq(name, $name), first: 1) {
            uid
        }
    }`;
    const vars = { $name: name };
    const res = await dgraphClient.newTxn().queryWithVars(query, vars);
    const ppl = await res.getJson();

    if (ppl.ingredient.length > 0) {
        ingredientCache[name] = ppl.ingredient[0].uid
        return ppl.ingredient[0].uid
    }
    return undefined
}

async function getRecipeUid (rid) {
    const query = `query all($rid: int) {
        recipe(func: eq(rid, $rid), first: 1) {
            uid
        }
    }`;
    const vars = { $rid: String(rid) };

    const res = await dgraphClient.newTxn().queryWithVars(query, vars);

    const ppl = res.getJson();

    if (ppl.recipe.length > 0) {
        return ppl.recipe[0].uid
    }
    return undefined
}

async function insertIngredient (name) {
    const txn = dgraphClient.newTxn();
    let uid = undefined
    try {
        const p = {
            name
        };

        const mu = new dgraph.Mutation();
        mu.setSetJson(p);
        const res = await txn.mutate(mu);
        await txn.commit()
        
        uid = res.getUidsMap().arr_[0][1]
        ingredientCache[name] = uid
    } finally {
        await txn.discard();
    }
    return uid
}

async function getOrInsertIngredient (name) {
    if ( ingredientCache[name] !== undefined ) {
        return ingredientCache[name]
    } else {
        const uid = await ingredientUid(name)
        if ( uid !== undefined ) {
            return uid
        } else {
            return insertIngredient(name)
        }
    }
}

async function insertRecipe ({title, rating, ingredients, rid}) {
    const p = {
        title,
        rating,
        rid,
        ingredient: await Promise.all(ingredients.map(async (ingredient) => ({
            "ingredient|quantity": ingredient.quantity,
            "uid": await getOrInsertIngredient(ingredient.ingredient)
        })))
    }

    const txn = dgraphClient.newTxn();
    try {
        const mu = new dgraph.Mutation();
        mu.setSetJson(p);
        const res = await txn.mutate(mu);
        await txn.commit();
    } finally {
        await txn.discard();
    }
}

async function queueIfNotInDb(data) {
    return Promise.all(data.otherRecipes.map( async (recipe) => {
        if (await getRecipeUid(recipe.rid) === undefined){
            recipeQueue.push(recipe)
        }
    }))
}

async function fetchAndInsertIfNotInDb (recipe) {
    const recipeUid = await getRecipeUid(recipe.rid)
    if (recipeUid) {
        logger.info(`Skip ${recipe.name} (${recipeQueue.length} remaining)`)
        if ( recipeQueue.length == 0 ) {
            const data = await parseUrl(recipe)
            await queueIfNotInDb(data)
        }
    } else {
        logger.info(`Insert ${recipe.name} (${recipeQueue.length} remaining)`)
        const data = await parseUrl(recipe)
        await insertRecipe(data)
        await queueIfNotInDb(data)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

const main = async () => {
    logger.info(`Let go 🚀`)
    await initDgraphSchema()
    while (recipeQueue.length > 0){
        const recipe = recipeQueue.pop()
        try {
            await fetchAndInsertIfNotInDb(recipe)
        } catch {
            logger.error(`Could not fetch ${recipe.name}. It is time to have a nap.`)
            recipeQueue.unshift(recipe)
            await sleep(60000)
        }
    }
    
    // console.log(await getOrInsertIngredient("g de pavot"))
    clientStub.close();
}

main()