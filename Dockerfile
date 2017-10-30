FROM apify/actor-node-chrome

COPY . ./

RUN npm install --quiet --only=prod --no-optional \
 && npm list

CMD [ "node", "main.js" ]