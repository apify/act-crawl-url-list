FROM apify/actor-node-chrome

COPY . ./

RUN npm install --quiet --only=prod --no-optional \
 && npm list

# Define that start command
CMD [ "node", "main.js" ]