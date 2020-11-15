import pydgraph
import json
import random
import unicodedata
import math

from sklearn.model_selection import train_test_split

from tqdm import tqdm

RECIPE_NAME_DATASET_FILE = "dataset/tgt-%s.txt"
RECIPE_INGREDIENTS_DATASET_FILE = "dataset/src-%s.txt"

def strip_accents(text):
    """
    Strip accents from input String.

    :param text: The input string.
    :type text: String.

    :returns: The processed String.
    :rtype: String.
    """
    try:
        text = unicode(text, 'utf-8')
    except (TypeError, NameError): # unicode is a default on python 3 
        pass
    text = unicodedata.normalize('NFD', text)
    text = text.encode('ascii', 'ignore')
    text = text.decode("utf-8")
    return str(text)

def format_str(string):
    string = string.lower()
    string = strip_accents(string)
    string = string.strip()
    return string

def train_val_test_split(data):
    train_and_val , test = train_test_split(data, random_state=0, test_size=0.1)
    train, val = train_test_split(train_and_val, random_state=0, test_size=0.20)
    return train, val, test

def gen_io(recipe): 
    title = format_str(recipe["title"])
    ingredients = recipe["ingredient"].copy()
    random.shuffle(ingredients)

    ingredients_str = " | ".join(map(lambda ingredient: format_str(ingredient["ingredient|quantity"]) + " " + format_str(ingredient["name"]), ingredients))

    return (title, ingredients_str)

def gen_ios(data, name, n_shuffle):
    recipe_names_out = open(RECIPE_NAME_DATASET_FILE % name, "a+")
    recipe_ingredients_out = open(RECIPE_INGREDIENTS_DATASET_FILE % name, "a+")
    try:
        for recipe in tqdm(data):
            for i in range(n_shuffle):
                try:
                    title, ingredients = gen_io(recipe)
                    if (len(title)>0 and len(ingredients) > 3):
                        recipe_names_out.write(title + '\n')
                        recipe_ingredients_out.write(ingredients + '\n')
                except Exception as e:
                    print(f"Skip {recipe}")
    except Exception as e:
        print('Error: {}'.format(e))
        recipe_names_out.close()
        recipe_ingredients_out.close()

def main(n_recipe=60000, n_shuffle=3):
    data = []
    page_size = 1000

    client_stub = pydgraph.DgraphClientStub("localhost:9080")
    client = pydgraph.DgraphClient(client_stub)

    for i in tqdm(range(math.ceil((n_recipe) / page_size))):
        query = """{
recipes (func: has (title), first: %d, offset: %d ) {
    title
    ingredient @facets(quantity) {
        name
    }
    }
}""" % (min(page_size, max(0, n_recipe - len(data))), len(data))

        recipes = client.txn(read_only=True).query(query)

        data += json.loads(recipes.json)["recipes"]
    client_stub.close()

    print(len(data))

    train, val, test = train_val_test_split(data)

    print("writting data")

    gen_ios(train, "train", n_shuffle)
    gen_ios(val, "val", n_shuffle)
    gen_ios(test, "test", n_shuffle)


if __name__ == '__main__':
    main()