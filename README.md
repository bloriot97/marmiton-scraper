# Recipe generator

## Repository structure

- export : contains the dataset to load on Dgraph
- gen_dataset.py : a script to convert the data loaded into Dgraph to src and tgt training data for seq2seq ml translation
- index.js : main script to scrap marmiton.org
- 

## Requirements

- Docker
- virtualen (recommended)
- node

## Marmiton scraper

### Setup

First install the dependencies:
```
npm install
```

then start Dgraph with docker:
```
docker run --rm -d -p 8000:8000 -p 8080:8080 -p 9080:9080 \
  --mount type=bind,source="$(pwd)"/export,target=/dgraph/export \
  --name dgraph-marmiton \
  dgraph/standalone:latest
```

### Load the data 

```
docker exec dgraph-marmiton dgraph live -f ./export/dgraph.r1750726.u0322.2008/g01.rdf.gz -s ./export/dgraph.r1750726.u0322.2008/g01.schema.gz
```

### Start the scraper

```
npm run start
```

## Gen the trainning data

### Setup

```
virtualenv --python=python3 venv
source ./venv/bin/activate
pip install -r ./requirements.txt
```

### Gen the dataset

```
python ./gen_dataset.py
```
